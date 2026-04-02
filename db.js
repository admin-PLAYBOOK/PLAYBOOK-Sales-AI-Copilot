const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    max: 20,
});

// ─────────────────────────────────────────────
// SCHEMA INIT — runs on startup, safe to re-run
// ─────────────────────────────────────────────
async function initSchema() {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS conversations (
                id          TEXT PRIMARY KEY,
                timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                history     JSONB NOT NULL DEFAULT '[]',
                lead_data   JSONB NOT NULL DEFAULT '{}',
                sales_output JSONB NOT NULL DEFAULT '{}',
                hubspot     JSONB NOT NULL DEFAULT '{}',
                model_used  TEXT,
                updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_conversations_timestamp
                ON conversations (timestamp DESC);

            CREATE INDEX IF NOT EXISTS idx_conversations_intent
                ON conversations ((lead_data->>'intent_level'));

            CREATE INDEX IF NOT EXISTS idx_conversations_email
                ON conversations ((lead_data->>'email'))
                WHERE lead_data->>'email' IS NOT NULL;

            -- Admin sessions table (survives server restarts)
            CREATE TABLE IF NOT EXISTS admin_sessions (
                id         TEXT PRIMARY KEY,
                expires_at TIMESTAMPTZ NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_sessions_expires
                ON admin_sessions (expires_at);
        `);
        console.log('✅ Database schema ready');
    } catch (err) {
        console.error('❌ Schema init error:', err.message);
        throw err;
    } finally {
        client.release();
    }
}

async function testConnection() {
    let client;
    try {
        client = await pool.connect();
        const result = await client.query('SELECT NOW() as time');
        console.log('✅ Connected to Neon PostgreSQL');
        console.log(`   Server time: ${result.rows[0].time}`);
        return true;
    } catch (err) {
        console.error('❌ Database connection error:', err.message);
        return false;
    } finally {
        if (client) client.release();
    }
}

async function saveConversation(data) {
    const client = await pool.connect();
    try {
        await client.query(`
            INSERT INTO conversations (id, timestamp, history, lead_data, sales_output, hubspot, model_used)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (id) DO UPDATE SET
                timestamp    = EXCLUDED.timestamp,
                history      = EXCLUDED.history,
                lead_data    = EXCLUDED.lead_data,
                sales_output = EXCLUDED.sales_output,
                hubspot      = EXCLUDED.hubspot,
                model_used   = EXCLUDED.model_used,
                updated_at   = NOW()
        `, [
            data.id,
            data.timestamp,
            JSON.stringify(data.history),
            JSON.stringify(data.lead_data),
            JSON.stringify(data.sales_output),
            JSON.stringify(data.hubspot),
            data.model_used
        ]);
        console.log(`💾 Saved conversation ${data.id}`);
    } catch (err) {
        console.error('Error saving conversation:', err.message);
        throw err;
    } finally {
        client.release();
    }
}

async function getConversations(limit = 200, offset = 0, filters = {}) {
    const client = await pool.connect();
    try {
        let query = `SELECT * FROM conversations WHERE 1=1`;
        const params = [];
        let i = 1;

        if (filters.intent_level) {
            query += ` AND lead_data->>'intent_level' = $${i++}`;
            params.push(filters.intent_level);
        }

        if (filters.has_email) {
            query += ` AND lead_data->>'email' IS NOT NULL`;
        }

        query += ` ORDER BY timestamp DESC LIMIT $${i++} OFFSET $${i++}`;
        params.push(limit, offset);

        const result = await client.query(query, params);
        return result.rows.map(parseRow);
    } finally {
        client.release();
    }
}

async function getConversation(id) {
    const client = await pool.connect();
    try {
        const result = await client.query(
            'SELECT * FROM conversations WHERE id = $1', [id]
        );
        return result.rows.length ? parseRow(result.rows[0]) : null;
    } finally {
        client.release();
    }
}

async function getStats() {
    const client = await pool.connect();
    try {
        const result = await client.query(`
            SELECT
                COUNT(*)::int                                                          AS total,
                COUNT(CASE WHEN lead_data->>'intent_level' = 'High'   THEN 1 END)::int AS high_intent,
                COUNT(CASE WHEN lead_data->>'intent_level' = 'Medium' THEN 1 END)::int AS medium_intent,
                COUNT(CASE WHEN lead_data->>'intent_level' = 'Low'    THEN 1 END)::int AS low_intent,
                COUNT(CASE WHEN lead_data->>'email' IS NOT NULL        THEN 1 END)::int AS emails_captured,
                COUNT(CASE WHEN hubspot->>'success' = 'true'           THEN 1 END)::int AS hubspot_synced
            FROM conversations
        `);
        return result.rows[0];
    } finally {
        client.release();
    }
}

// ── helper: parse JSONB fields that may already be objects ──
function parseRow(row) {
    const parse = v => (typeof v === 'string' ? JSON.parse(v) : v);
    return {
        ...row,
        history:      parse(row.history),
        lead_data:    parse(row.lead_data),
        sales_output: parse(row.sales_output),
        hubspot:      parse(row.hubspot),
    };
}

// ─────────────────────────────────────────────
// ADMIN SESSIONS
// ─────────────────────────────────────────────

async function createSession(id, expiresAt) {
    const client = await pool.connect();
    try {
        await client.query(
            `INSERT INTO admin_sessions (id, expires_at) VALUES ($1, $2)
             ON CONFLICT (id) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
            [id, expiresAt]
        );
    } finally {
        client.release();
    }
}

async function validateSession(id) {
    const client = await pool.connect();
    try {
        const result = await client.query(
            `SELECT id FROM admin_sessions WHERE id = $1 AND expires_at > NOW()`,
            [id]
        );
        return result.rows.length > 0;
    } finally {
        client.release();
    }
}

async function deleteSession(id) {
    const client = await pool.connect();
    try {
        await client.query(`DELETE FROM admin_sessions WHERE id = $1`, [id]);
    } finally {
        client.release();
    }
}

// Purge expired sessions — call periodically or on startup
async function cleanExpiredSessions() {
    const client = await pool.connect();
    try {
        const result = await client.query(
            `DELETE FROM admin_sessions WHERE expires_at < NOW()`
        );
        if (result.rowCount > 0) {
            console.log(`🧹 Purged ${result.rowCount} expired session(s)`);
        }
    } finally {
        client.release();
    }
}

module.exports = {
    initSchema,
    testConnection,
    saveConversation,
    getConversations,
    getConversation,
    getStats,
    createSession,
    validateSession,
    deleteSession,
    cleanExpiredSessions,
};