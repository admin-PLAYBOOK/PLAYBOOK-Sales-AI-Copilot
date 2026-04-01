const { Pool } = require('pg');

// Create connection pool for Neon
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false, 
    },
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    max: 20,
});

// Test connection
async function testConnection() {
    let client;
    try {
        client = await pool.connect();
        const result = await client.query('SELECT NOW() as time');
        console.log('✅ Connected to Neon PostgreSQL');
        console.log(`   Server time: ${result.rows[0].time}`);
        client.release();
        return true;
    } catch (err) {
        console.error('❌ Database connection error:', err.message);
        if (client) client.release();
        return false;
    }
}

// Save or update conversation
async function saveConversation(data) {
    const client = await pool.connect();
    try {
        const query = `
            INSERT INTO conversations (id, timestamp, history, lead_data, sales_output, hubspot, model_used)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (id) DO UPDATE SET
                timestamp = EXCLUDED.timestamp,
                history = EXCLUDED.history,
                lead_data = EXCLUDED.lead_data,
                sales_output = EXCLUDED.sales_output,
                hubspot = EXCLUDED.hubspot,
                model_used = EXCLUDED.model_used,
                updated_at = NOW()
            RETURNING *
        `;
        
        const result = await client.query(query, [
            data.id,
            data.timestamp,
            JSON.stringify(data.history),
            JSON.stringify(data.lead_data),
            JSON.stringify(data.sales_output),
            JSON.stringify(data.hubspot),
            data.model_used
        ]);
        
        console.log(`💾 Saved conversation ${data.id} to database`);
        return result.rows[0];
    } catch (err) {
        console.error('Error saving conversation:', err.message);
        throw err;
    } finally {
        client.release();
    }
}

// Get recent conversations
async function getConversations(limit = 200, offset = 0, filters = {}) {
    const client = await pool.connect();
    try {
        let query = `SELECT * FROM conversations WHERE 1=1`;
        const params = [];
        let paramIndex = 1;
        
        if (filters.intent_level) {
            query += ` AND lead_data->>'intent_level' = $${paramIndex}`;
            params.push(filters.intent_level);
            paramIndex++;
        }
        
        if (filters.has_email) {
            query += ` AND lead_data->>'email' IS NOT NULL`;
        }
        
        query += ` ORDER BY timestamp DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(limit, offset);
        
        const result = await client.query(query, params);
        
        return result.rows.map(row => ({
            ...row,
            history: typeof row.history === 'string' ? JSON.parse(row.history) : row.history,
            lead_data: typeof row.lead_data === 'string' ? JSON.parse(row.lead_data) : row.lead_data,
            sales_output: typeof row.sales_output === 'string' ? JSON.parse(row.sales_output) : row.sales_output,
            hubspot: typeof row.hubspot === 'string' ? JSON.parse(row.hubspot) : row.hubspot
        }));
    } finally {
        client.release();
    }
}

// Get single conversation
async function getConversation(id) {
    const client = await pool.connect();
    try {
        const result = await client.query(
            'SELECT * FROM conversations WHERE id = $1',
            [id]
        );
        
        if (result.rows.length === 0) return null;
        
        const row = result.rows[0];
        return {
            ...row,
            history: JSON.parse(row.history),
            lead_data: JSON.parse(row.lead_data),
            sales_output: JSON.parse(row.sales_output),
            hubspot: JSON.parse(row.hubspot)
        };
    } finally {
        client.release();
    }
}

// Get conversation statistics
async function getStats() {
    const client = await pool.connect();
    try {
        const result = await client.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN lead_data->>'intent_level' = 'High' THEN 1 END) as high_intent,
                COUNT(CASE WHEN lead_data->>'intent_level' = 'Medium' THEN 1 END) as medium_intent,
                COUNT(CASE WHEN lead_data->>'intent_level' = 'Low' THEN 1 END) as low_intent,
                COUNT(CASE WHEN lead_data->>'email' IS NOT NULL THEN 1 END) as emails_captured
            FROM conversations
        `);
        
        return result.rows[0];
    } finally {
        client.release();
    }
}

module.exports = {
    testConnection,
    saveConversation,
    getConversations,
    getConversation,
    getStats
};