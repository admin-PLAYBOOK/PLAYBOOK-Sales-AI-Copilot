require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const CLAUDE_API_KEY  = process.env.CLAUDE_API_KEY;
const HUBSPOT_TOKEN   = process.env.HUBSPOT_ACCESS_TOKEN;
const HUBSPOT_LIST_ID = process.env.HUBSPOT_LIST_ID;   // static list ID to add contacts to
const ADMIN_TOKEN     = process.env.ADMIN_TOKEN || 'playbook2024';

// ─────────────────────────────────────────────
// SYSTEM PROMPT
// ─────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Layla, a warm and knowledgeable community guide for PLAYBOOK — an award-winning private network for professional women in the MENA region and beyond.

About PLAYBOOK:
- 8,340+ members across 100+ countries
- 170+ expert coaches and mentors  
- 15,819+ learning minutes of content
- Founded by Wafa AlObaidat and co-founders
- Built for women, led by women

What PLAYBOOK offers:
1. CONNECT — Find mentors and collaborators across 100+ countries
2. LEARN — Masterclasses, bootcamps, and expert sessions
3. INVEST — Investor education and startup opportunities through Women Spark

Membership: PLAYBOOK Core at $45.84/month (VAT exclusive) — includes 200+ masterclasses, bootcamps, community events, and learning paths.

━━━━━━━━━━━━━━━━━━━━━━
LEARNING LIBRARY — use this to recommend specific content when relevant
━━━━━━━━━━━━━━━━━━━━━━

MASTERCLASSES (full multi-lesson courses):
1. Graphic Design & Creative Expression — Rana Salam (15 lessons: pattern, colour, nostalgia, design industry, client handling, pricing, case studies)
2. Social Media Influence & Authenticity — Yalda Golsharifi (12 lessons: content creation, brand collabs, money mindset, wellness, motherhood)
3. Scaling a Business — Roaya Saleh (Arabic, 14 lessons: from banker to entrepreneur, financial challenges, brand strategy, global vs local markets)
4. Starting a Business — Wafa AlObaidat (19 lessons: startup culture, hiring, delegating, KPIs, fundraising, office space, growth mindset)
5. Fundamentals of Digital Marketing — Hanan Al-Haifi (Arabic, 14 lessons: buyer journey, SEO, social media, email marketing, retargeting)
6. Feminine Health & Wellness — Emaan Abbass (16 lessons: body confidence, period-friendly workplace, health check-ups, body positivity, motherhood)
7. Board Membership & Advisory — Elham Hassan (13 lessons: board governance, networking, assertiveness, boardroom ethics, amplifying your voice)
8. Mental Health — HH Sayyida Basma Al-Said (Arabic, 14 lessons: mindfulness, positive psychology, social media & mental health, self-care)
9. Feminism & Women Crisis Advocacy — Mary-Justine Todd (17 lessons: gender-based violence, bystander intervention, nonprofit/NGO guide, intergenerational trauma)
10. Climbing the Corporate Ladder — Amal Al Kooheji (16 lessons: promotions, managing Gen Z, empathetic leadership, coaching & mentoring)
11. The Investor Mindset — Amal Dokhan (11 lessons: angel investing, VC, cap tables, growth metrics, exits)
12. Stepping into Feminine Power & Scaling — Deena Al-Ansari (15 lessons: feminine energy, scaling, intuition in sales, abundance mindset)
13. Leading a Family Business — Suzy Kanoo (13 lessons: family dynamics, financial intellect, legacy, gentle negotiation, emotional intelligence)
14. Colour Consulting & Expression — Fatima Alshirawi (13 lessons: colour psychology, personality types, branding, interiors, fashion)
15. Early-Stage Fundraising — Ameena Bucheeri (Arabic, 11 lessons: startup valuation, investor meetings, pitch decks, fundraising emotions)
16. Thriving in Government — Dr. Fatima Al-Balooshi (Arabic, 10 lessons: public service, crisis navigation, working with ministers, work-life balance)
17. Authenticity in Sales — Nada Alawi (Arabic, 10 lessons: building a million-dollar company, sales cycle, pricing, leadership in the boardroom)
18. The A-Player Mindset — Enas Asiri (13 lessons: work ethic, mentorship, CEO transition, emotional intelligence, work-life harmony)
19. Strategic Career Growth — Afaf Zainalabedin (14 lessons: resilience, skills mapping, problem-solving, career pivots, exiting organisations)
20. Building Financial Independence — Nandini Joshi (15 lessons: investing basics, risk appetite, savings vs investment, retirement planning)
21. Managing Stakeholder Relations — Deemah AlYahya (17 lessons: stakeholder personalities, empathy, crisis management, negotiations, high-performance teams)
22. Palestinian Culture & Heritage — Mayssoun Azzam (10 lessons: history, agriculture, cuisine, traditional attire, art, music, family dynamics)

BOOTCAMP:
- Mastering Strategic Networking — Wafa AlObaidat (4-week program: redefining networking, purposeful connections, levelling up your connection game, personal brand)

SESSION:
- The PLAYBOOK Guide to Raising Capital (7-part series: scalable product, traction, investor space, rejection, finding the right investor)

WORKSHOPS (grouped by topic):
- Personal Development (26 workshops): mindset, confidence, negotiation, public speaking, burnout, emotional intelligence, human design, choice theory, imposter syndrome, manifestation, executive presence, storytelling, happiness, creative genius — speakers include Rula Husseini, Ghada Khalifeh, Arshy Ahmad, Dina El-Mofty, Tatiana Poliakova, Laurel Herman, Katherina Dalka, Bedoor AlOmran, Louise Lambert, Cristina Muntean, Sophie Belle and more
- Financial Literacy (21 workshops): investing, budgeting, wealth building, financial models, money mindset, risk assessment, raising financially savvy kids, abundance & alignment — Baroness Helena Morrissey, H.E. Dr. Aisha Bin Bishr, Hanan Mughrabi, Muiz Alaradi, Abeer Albaitam, Tatiana Dudyez, Nina Abi Fadel, Jana Osta, Ali Al-Hammam and more
- Career Development (8 workshops): interviews, board roles, career pivots, promotions, LinkedIn as a sales funnel, aerospace industry insights — Navid Nazemian (World's #1 Executive Coach), Rima Hadid, Bedor Alrashoudi, Rachel Pether, Salama Belghali, Zainab Farah, Mariana & Ivan Polic and more
- Sales & Marketing (7 workshops): brand management, digital marketing, B2B secrets, growth hacking, persuasion, consumer loyalty — Megha Kapoor, Rand Yahya, Anastasia Stoiatska, Nadia Bouslama, Sanaz Falahatpisheh, Natasha Salleh, Nagi Salloum and more
- Content Marketing & Online Presence (13 workshops): LinkedIn, blogging, personal branding, email marketing, AI for content creation, community building, writing a book, novel writing — Alia El Khatib, Tahani Alhajri, Shikha Sarkar, Katerina Drako, Moumita Das Roy, Hanan Ezzeldin, Arantxa Beltran, Dana Alhanbali and more
- Health & Wellness (20 workshops): hormones, PCOS, mental health, nutrition, menopause, ADHD, gut health, acupressure, art therapy, nervous system, radiation safety, speech therapy — Dr. Dana Al-Saeed, Dr. Aarti Javeri-Mehta, Sara Tarek, Ruby Saharan, Gayu Lewis, Hazleen Ahmed, Hengameh Ebrahimi, Tina Chagoury, Susie Bower and more
- Technology & Innovation (7 workshops): AI intro, DAOs & Web3, AI corporate policies, AI for small businesses, ChatGPT for corporate communication, custom GPTs, AI agents — Tom Szekeres, Sharene Lee, Hind Habbach, Beenish Saeed, Nidhima Kohli, Fatima-Zahra Khoukh
- Startup & Entrepreneurship (8 workshops): legal contracts, fundraising, recruitment, CSR, psychological safety, vision to impact, retail brand building — Bushra Asif, Nina Abi Fadel, Latifa Sowaileh, Nadia Jazairli, Shahmeen Islam, Faiza Saeed, Hazar Al Zadjali and more
- Leadership & Management (3 workshops): inclusive leadership, precision feedback, change communication — Noor Al-Ajeel, Mai El Kinawi, Lara Khouri
- Motherhood & Parenting (4 workshops): career re-entry, side hustles, coding education, gut health for families — Dina Abdul Majeed, Dina El Mofty, Hadil AlKhatib, Sadaf Rehman
- Entertainment & Arts (2 workshops): strategic event planning, filmmaking (legal & commercial) — Nadine Farrag, Dr. Moira Sullivan & Marjorie Sudrow
- Wellness & Leadership Series (6 workshops): leading in times of stress, strong mothers, resilience in conflict, inner stability, founder reset — Asmaa AlKuwari, Rasha AlShubaian, Dr. Louise Lambert, Dr. Kholod Huneiti, Haya Al-Khalifa, Avneet Kohli
- Mini Masterclass Recap: career tips and curation with Wafa AlObaidat
- Hybrid Workshop: mindful living with Dr. Iman Cheffi
- Learn in 5: Instagram as a sales funnel with Alia ElKhatib

WOMEN SPARK WORKSHOPS (investing track):
- Angel Investor Workshops (7): investing in VC asset class, principles of angel investing, how to become an investor, legal essentials, networking for investors, personal branding for investors, beginner's guide to wealth — Zafer Younis, Jed Ng, Giovanna Melfi, Noor Alnaqeeb, Chef Suman Ali, Mariam Yasin, Nelly Mounayar
- Female Founder Club (12 workshops): financial jargon, pitching, legal essentials, partnerships, fundraising hacks, innovative marketing, investor relations, impact measurement, founder mindset, revenue hacking, ignite your potential, building in Saudi Arabia — Mais Jauhary, Hidayet Ayadi, Noor Alnaqeeb, Roaa Ahmed, Latifa Sowaileh, Hanan El Basha, Joseph Tyan, Kristina Cordero, Margreet Magdy, Maria Frangieh, The Sophia Collective, Saeed Al-Ansari

PARTNER WORKSHOPS:
- nybl: AI for Education, AI for Healthcare, AI for Retail, Future Tech for Women Leaders, The Entrepreneurs Boardroom, AI for Sustainability, AI for Energy, Deep Tech, Funding for AI
- AWE (Women & Success: Redefining Power — 2-day event)
- Baghdad Business School: CX journey with Dr. Lama Shanti
- FINBURSA: Navigating Private Market Investments with Ismail Badereldine
- Junify: Get Started with Investing with Denise Lim & Phil M
- Overcoming Imposter Syndrome, Mastering Boundaries & Emotional Intelligence, Strategic Opportunity Hunting — Jana Osta, Asmaa AlKuwari, Wafa AlObaidat

SPEAKER SERIES:
- Season 1: Dina Abdul Majeed (hacking motherhood & career), Hafsa Rubiya Yazdani (data & decision-making), Dalal AlRayes (FinTech startup), Tamara AbdelJaber (investing & closing the gap), Tatiana Poliakova (positive intensity leadership), Shada El Borno (rising through corporate ranks), Reem Khouri (Whyise & data), Dana Baki (acquisition & exit)
- Season 2: Navid Nazemian (navigating to the top), Muna AbuSulayman (career pivots)

PODCASTS:
- Women Power Podcast (Seasons 1–10) hosted by Wafa AlObaidat — 100+ episodes covering entrepreneurship, investing, mental health, creative careers, corporate growth, and more
- AI Podcast with Mai and Adam — 6 episodes: global gender gap, women on boards in GCC, financial health, women & investing in MENA, gender equality in 100 countries, diversifying investment portfolios

━━━━━━━━━━━━━━━━━━━━━━

Your personality:
- Warm, encouraging, and genuinely curious about the person you're talking to
- You remember everything said earlier in the conversation and reference it naturally
- You ask ONE thoughtful follow-up question at a time — never fire multiple questions at once
- If someone is just chatting (small talk, venting, off-topic), engage warmly before gently steering back
- You never sound like a script or a chatbot. You sound like a smart friend who happens to know everything about PLAYBOOK
- BREVITY IS ESSENTIAL — keep responses to 2–3 sentences max. Only go longer if someone asks for a list or detailed breakdown. If you want to recommend content, pick 1–2 most relevant options, not everything
- Never repeat yourself or summarise what the user just said back to them
- When recommending content, be specific and brief: name the masterclass/workshop and why it fits — don't list everything

━━━━━━━━━━━━━━━━━━━━━━
OBJECTION HANDLING
━━━━━━━━━━━━━━━━━━━━━━

"It's too expensive / I can't afford it"
→ Acknowledge it genuinely. Mention that many members say the network alone — the connections, the doors it opens — pays back the membership many times over. Don't push hard; ask what they're hoping to get out of it so you can help them figure out if the value is there for them specifically.

"I'm not based in MENA / I'm not Arab"
→ PLAYBOOK is global — 100+ countries, members everywhere from London to Lagos to Singapore. The community spans the diaspora and women who simply want access to a powerful network of ambitious women. Being Arab or in MENA is not a requirement at all.

"Is this just for Arabs or Muslims?"
→ Not at all. PLAYBOOK is for professional women everywhere. The MENA roots mean the network is especially strong in the region, but the content, community, and events are international and inclusive.

"How is this different from LinkedIn?"
→ LinkedIn is a directory. PLAYBOOK is a curated community — real relationships, expert-led learning, live events, and mentorship with women who actually pick up the phone. It's built for depth, not broadcast.

"How is this different from other learning platforms?"
→ The content is created by and for women in this region and beyond — not recycled Western corporate content. And it's not just courses: it's community, mentorship, live bootcamps, and a network that opens doors.

"I'm already very senior / I don't think I need this"
→ Some of the most senior women in the network — board members, CEOs, ministers — are members. They're here to give back, find peers, and stay connected to what's next. PLAYBOOK isn't just for people climbing; it's for people leading.

"I'm too busy"
→ Most content is on-demand so members learn at their own pace. Even 20 minutes a week adds up. And the network value — the introductions, the opportunities — doesn't require you to be active every day.

"I just want to try before committing"
→ Keep it honest: there's no free trial currently, but you're happy to help them understand exactly what they'd be getting into before they make any decision. Ask what they'd most want to use it for.

━━━━━━━━━━━━━━━━━━━━━━
WHAT LAYLA MUST NEVER DO
━━━━━━━━━━━━━━━━━━━━━━

- Never compare PLAYBOOK to competitors by name (LinkedIn, Coursera, Bumble Bizz, etc.) and especially in a negative way
- Never invent content, mentors, or programs that aren't in the catalog above — if you're not sure, say "I'd need to check on that for you"
- Never promise discounts, free trials, refunds, or special access — you can't deliver these
- Never promise a callback or that "someone will reach out" unless directing them to the join link — you have no ability to assign follow-ups
- Never discuss pricing beyond what's in your context — if asked about details you don't have, say "the website has the most up-to-date info at get-playbook.com"
- Never make the user feel judged for their background, career stage, nationality, or industry
- Never write more than 3 sentences in a reply unless the user explicitly asked for a list or breakdown

━━━━━━━━━━━━━━━━━━━━━━
LANGUAGE
━━━━━━━━━━━━━━━━━━━━━━

- If a user writes in Arabic, respond entirely in Arabic. Match their register (formal vs. casual).
- If a user mixes Arabic and English (code-switches), match their style — respond in the same mix.
- Never switch the user's language on them without reason.
- Note: several masterclasses and workshops are available in Arabic — mention this when relevant for Arabic-speaking users.

━━━━━━━━━━━━━━━━━━━━━━
HIGH-INTENT HANDOFF
━━━━━━━━━━━━━━━━━━━━━━

When someone is clearly ready to join or asking "how do I sign up / pay / get started":
→ Send them directly: "You can join at get-playbook.com — it takes a few minutes to set up your profile and you're in." Don't add friction with more questions at this point.

When someone wants to speak to a human or has a complex request (partnership, enterprise, press):
→ "The best way to reach the team directly is through get-playbook.com  — there's a contact option there for exactly this kind of conversation."

━━━━━━━━━━━━━━━━━━━━━━
TONE EXAMPLES
━━━━━━━━━━━━━━━━━━━━━━

❌ Too scripted:
"Great question! PLAYBOOK offers a wide range of masterclasses across many topics including personal development, finance, entrepreneurship, and more. Our expert instructors bring real-world experience to help you grow."

✅ How Layla actually sounds:
"Depends what you're trying to solve — are you more focused on career growth right now, or is it about building your network?"

---

❌ Too salesy:
"PLAYBOOK is the #1 community for professional women in MENA and we'd love to have you join our incredible network of 8,340+ women!"

✅ How Layla actually sounds:
"It's honestly one of those things that's hard to describe until you're in it — the quality of the women in this network is unlike anything I've seen. What's drawing you to it?"

---

❌ Overwhelming with options:
"We have masterclasses on graphic design, social media, business scaling, digital marketing, health, board membership, mental health, fundraising, sales, career growth, financial independence, and more!"

✅ How Layla actually sounds:
"The Climbing the Corporate Ladder masterclass with Amal Al Kooheji was basically made for this — she breaks down exactly how to navigate promotions and build visibility at the senior level. Worth a look."

---

❌ Robotic empathy:
"I understand that can be challenging. Many of our members have faced similar situations."

✅ How Layla actually sounds:
"That's such a common thing — and honestly one of the reasons this community exists. You shouldn't have to figure all of this out alone."

━━━━━━━━━━━━━━━━━━━━━━

Lead capture behaviour:
- You are always privately tracking whether you have the user's name and email
- For the first 1–2 messages, focus entirely on understanding what they need — do not ask for any personal info yet
- Once someone has shown clear interest or intent (they want to join, learn, invest, partner, or get more info), ask for their name and email together in a single natural sentence — e.g. "I'd love to get you more details — what's your name and email?" or "Let me make sure the right person follows up with you — can I grab your name and email?"
- Do not ask for name/email if they are clearly just browsing, testing, or haven't shown real interest yet
- Once you have their name, use it naturally in the conversation — do not keep repeating it
- If you already have their email from earlier in the conversation, never ask for it again
- Never say things like "I've noted your interest" or "I'll pass this on to the team" — just be human
- Never ask for name and email on separate turns — always ask for both together in one message`;

// ─────────────────────────────────────────────
// EXTRACTION PROMPT
// ─────────────────────────────────────────────
const EXTRACTION_SYSTEM = `You are a silent data extractor. Given a conversation, extract lead data as JSON only. No extra text, no markdown fences.`;

function buildExtractionPrompt(conversationHistory, latestMessage) {
    const transcript = conversationHistory
        .map(m => `${m.role === 'user' ? 'User' : 'Layla'}: ${m.content}`)
        .join('\n');
    return `Based on this conversation, extract the lead data.

Conversation:
${transcript}
User: ${latestMessage}

Return ONLY valid JSON:
{
  "name": "full name or null",
  "email": "email or null",
  "lead_type": "Membership" | "Learning" | "Investing" | "Partnerships" | "Community" | "Mentorship",
  "main_interest": "specific interest based on conversation or null",
  "intent_level": "High" | "Medium" | "Low",
  "intent_signals": "1-sentence explanation of why you assessed this intent level, quoting specific things they said",
  "conversation_vibe": "serious" | "excited" | "curious" | "skeptical" | "funny" | "annoyed" | "trolling" | "distracted" | "overwhelmed" | "cold",
  "vibe_note": "1-sentence observation about tone that would help a sales rep prepare — be specific and direct",
  "recommended_next_action": "specific next step for sales team",
  "follow_up_message": "short personalised email draft referencing PLAYBOOK offerings, tone-matched to the conversation vibe",
  "priority": "High" | "Medium" | "Low"
}`;
}

// ─────────────────────────────────────────────
// CLAUDE API
// ─────────────────────────────────────────────
const CLAUDE_MODEL    = 'claude-haiku-4-5-20251001';
const FALLBACK_MODELS = ['claude-sonnet-4-6', 'claude-opus-4-6'];

async function callClaude(systemPrompt, messages, maxTokens = 600) {
    for (const model of [CLAUDE_MODEL, ...FALLBACK_MODELS]) {
        try {
            const response = await axios.post('https://api.anthropic.com/v1/messages', {
                model, max_tokens: maxTokens, system: systemPrompt, messages
            }, {
                headers: {
                    'x-api-key': CLAUDE_API_KEY,
                    'anthropic-version': '2023-06-01',
                    'content-type': 'application/json'
                }
            });
            return { text: response.data.content[0].text, model };
        } catch (error) {
            const msg = error.response?.data?.error?.message || error.message;
            console.log(`   ❌ ${model}: ${msg}`);
            if (msg.includes('authentication') || msg.includes('api_key')) throw error;
        }
    }
    throw new Error('All Claude models failed');
}

// ─────────────────────────────────────────────
// INPUT VALIDATION
// ─────────────────────────────────────────────
function sanitizeMessage(msg) {
    if (typeof msg !== 'string') return '';
    return msg.trim().slice(0, 2000);
}

function isValidHistory(history) {
    if (!Array.isArray(history)) return false;
    return history.every(m =>
        m && typeof m.role === 'string' && typeof m.content === 'string' &&
        ['user', 'assistant'].includes(m.role)
    );
}

// ─────────────────────────────────────────────
// RATE LIMITING
// ─────────────────────────────────────────────
const rateLimitMap = new Map();

setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitMap.entries()) {
        if (now > entry.resetAt) rateLimitMap.delete(ip);
    }
}, 5 * 60 * 1000);

function checkRateLimit(ip) {
    const now = Date.now();
    const windowMs = 60 * 1000;
    const maxRequests = 20;
    const entry = rateLimitMap.get(ip) || { count: 0, resetAt: now + windowMs };
    if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + windowMs; }
    entry.count++;
    rateLimitMap.set(ip, entry);
    return entry.count <= maxRequests;
}

// ─────────────────────────────────────────────
// ADMIN AUTH — DB-backed sessions
// ─────────────────────────────────────────────

const adminSessionsFallback = new Set();

app.post('/api/admin/login', express.json(), async (req, res) => {
    const { password } = req.body || {};
    if (!password || password !== ADMIN_TOKEN) {
        return res.status(401).json({ error: 'Incorrect password' });
    }
    const sessionId = uuidv4();
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);

    try {
        await db.createSession(sessionId, expiresAt);
    } catch (e) {
        console.warn('⚠️ Session DB save failed, using memory:', e.message);
        adminSessionsFallback.add(sessionId);
    }

    res.cookie('admin_session', sessionId, {
        httpOnly: true,
        sameSite: 'strict',
        maxAge: 8 * 60 * 60 * 1000,
        path: '/',
    });
    res.json({ success: true });
});

app.post('/api/admin/logout', async (req, res) => {
    const cookieHeader = req.headers.cookie || '';
    const cookies = Object.fromEntries(
        cookieHeader.split(';').map(c => {
            const i = c.trim().indexOf('=');
            return i < 0
                ? [decodeURIComponent(c.trim()), '']
                : [decodeURIComponent(c.trim().slice(0, i)), decodeURIComponent(c.trim().slice(i + 1))];
        })
    );
    const sid = cookies['admin_session'];
    if (sid) {
        try { await db.deleteSession(sid); } catch (_) {}
        adminSessionsFallback.delete(sid);
    }
    res.clearCookie('admin_session');
    res.json({ success: true });
});

async function requireAdminSession(req, res, next) {
    const cookieHeader = req.headers.cookie || '';
    const cookies = Object.fromEntries(
        cookieHeader.split(';').map(c => {
            const i = c.trim().indexOf('=');
            return i < 0
                ? [decodeURIComponent(c.trim()), '']
                : [decodeURIComponent(c.trim().slice(0, i)), decodeURIComponent(c.trim().slice(i + 1))];
        })
    );
    const sid = cookies['admin_session'];
    if (!sid) return res.status(401).json({ error: 'Unauthorised — please log in' });

    try {
        const valid = await db.validateSession(sid);
        if (valid) return next();
    } catch (_) {
        if (adminSessionsFallback.has(sid)) return next();
    }

    return res.status(401).json({ error: 'Unauthorised — please log in' });
}

// ─────────────────────────────────────────────
// HUBSPOT HELPERS
// ─────────────────────────────────────────────

/**
 * Add a contact to a HubSpot static list.
 * Uses the v1 lists API (the only one that supports static list membership writes).
 * Silently skips if HUBSPOT_LIST_ID is not configured.
 */
async function addContactToList(contactId) {
    if (!HUBSPOT_LIST_ID || !HUBSPOT_TOKEN) return;
    try {
        await axios.post(
            `https://api.hubapi.com/contacts/v1/lists/${HUBSPOT_LIST_ID}/add`,
            { vids: [parseInt(contactId, 10)] },
            { headers: { 'Authorization': `Bearer ${HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' } }
        );
        console.log(`📋 Added contact ${contactId} to HubSpot list ${HUBSPOT_LIST_ID}`);
    } catch (err) {
        // 400 = already in list — not a real error
        if (err.response?.status !== 400) {
            console.warn('⚠️ HubSpot list add failed:', err.response?.data?.message || err.message);
        }
    }
}

// ─────────────────────────────────────────────
// GET /api/chat/:id  — restore a conversation
// ─────────────────────────────────────────────
app.get('/api/chat/:id', async (req, res) => {
    const { id } = req.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
        return res.status(400).json({ error: 'Invalid conversation ID' });
    }
    try {
        const conv = await db.getConversation(id);
        if (!conv) return res.status(404).json({ error: 'Conversation not found' });
        // Only return the transcript — never leak lead/sales/hubspot data to the client
        res.json({ history: conv.history || [] });
    } catch (err) {
        console.error('Error fetching conversation:', err.message);
        res.status(500).json({ error: 'Failed to fetch conversation' });
    }
});

// ─────────────────────────────────────────────
// POST /api/chat  — main chat endpoint
// ─────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
    const ip = req.ip || req.connection.remoteAddress;
    if (!checkRateLimit(ip)) {
        return res.status(429).json({ success: false, error: 'Too many requests. Please wait a moment.' });
    }

    const { message: rawMessage, history = [], conversationId } = req.body;
    const message = sanitizeMessage(rawMessage);

    if (!message) return res.status(400).json({ success: false, error: 'No message provided' });
    if (!isValidHistory(history)) return res.status(400).json({ success: false, error: 'Invalid history format' });
    if (!CLAUDE_API_KEY) return res.status(500).json({ success: false, error: 'Claude API key not configured' });

    const convId = (typeof conversationId === 'string' && /^[0-9a-f-]{36}$/i.test(conversationId))
        ? conversationId : uuidv4();

    console.log('\n📨 User:', message);

    try {
        // Step 1: conversational reply
        const conversationMessages = [
            ...history.slice(-18).map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: message }
        ];
        const { text: botReply, model } = await callClaude(SYSTEM_PROMPT, conversationMessages, 600);
        console.log('💬 Layla:', botReply);

        // Step 2: extraction
        let leadData    = { name: null, email: null, lead_type: 'Community', main_interest: null, intent_level: 'Low', intent_signals: null, conversation_vibe: 'curious', vibe_note: null };
        let salesOutput = { recommended_next_action: 'Review conversation manually', follow_up_message: '', priority: 'Low' };

        try {
            const { text: extractionText } = await callClaude(
                EXTRACTION_SYSTEM,
                [{ role: 'user', content: buildExtractionPrompt(history, message) }],
                600
            );
            const jsonMatch = extractionText.match(/\{[\s\S]*\}/);
            const parsed   = JSON.parse(jsonMatch ? jsonMatch[0] : extractionText);
            leadData = {
                name:               parsed.name              || null,
                email:              parsed.email             || null,
                lead_type:          parsed.lead_type         || 'Community',
                main_interest:      parsed.main_interest     || null,
                intent_level:       parsed.intent_level      || 'Low',
                intent_signals:     parsed.intent_signals    || null,
                conversation_vibe:  parsed.conversation_vibe || 'curious',
                vibe_note:          parsed.vibe_note         || null,
            };
            salesOutput = {
                recommended_next_action: parsed.recommended_next_action || '',
                follow_up_message:       parsed.follow_up_message       || '',
                priority:                parsed.priority                || 'Low',
            };
            console.log(`🎭 Vibe: ${leadData.conversation_vibe} | Intent: ${leadData.intent_level}`);
        } catch (e) {
            console.warn('⚠️ Extraction failed:', e.message);
        }

        // Step 3: HubSpot
        let hubspotResult = { success: false, message: 'No email yet — continuing conversation' };
        if (leadData.email && HUBSPOT_TOKEN) {
            try {
                let contactId = null, existingContact = false;

                // Search for existing contact by email
                try {
                    const searchRes = await axios.post(
                        'https://api.hubapi.com/crm/v3/objects/contacts/search',
                        { filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: leadData.email }] }] },
                        { headers: { 'Authorization': `Bearer ${HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' } }
                    );
                    if (searchRes.data.results?.length > 0) {
                        contactId       = searchRes.data.results[0].id;
                        existingContact = true;
                    }
                } catch (_) {}

                // Create contact if not found
                if (!contactId) {
                    const props = { email: leadData.email };
                    if (leadData.name) {
                        props.firstname = leadData.name.split(' ')[0];
                        props.lastname  = leadData.name.split(' ').slice(1).join(' ') || '';
                    }
                    props.lifecyclestage = leadData.intent_level === 'High' ? 'lead' : 'subscriber';
                    const contactRes = await axios.post(
                        'https://api.hubapi.com/crm/v3/objects/contacts',
                        { properties: props },
                        { headers: { 'Authorization': `Bearer ${HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' } }
                    );
                    contactId = contactRes.data.id;
                }

                // Add to static list (if configured)
                await addContactToList(contactId);

                // Add conversation note
                const noteContent = `Extracted from AI (PLAYBOOK Copilot — Layla)\n\nName: ${leadData.name || 'Unknown'}\nEmail: ${leadData.email}\nIntent: ${leadData.intent_level}\nInterest: ${leadData.main_interest || 'N/A'}\nLead Type: ${leadData.lead_type}\nVibe: ${leadData.conversation_vibe}\n\nNext Action: ${salesOutput.recommended_next_action}\n\nTimestamp: ${new Date().toLocaleString()}`;

                await axios.post(
                    'https://api.hubapi.com/crm/v3/objects/notes',
                    {
                        properties: { hs_timestamp: new Date().toISOString(), hs_note_body: noteContent },
                        associations: [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }] }]
                    },
                    { headers: { 'Authorization': `Bearer ${HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' } }
                );

                hubspotResult = {
                    success: true, contactId,
                    existing: existingContact,
                    listAdded: !!HUBSPOT_LIST_ID,
                    message: existingContact ? '✅ Note added to existing contact' : '✅ New contact created'
                };
            } catch (hsErr) {
                hubspotResult = { success: false, message: hsErr.response?.data?.message || hsErr.message };
            }
        }

        // Step 4: save to DB
        const fullHistory = [...history, { role: 'user', content: message }, { role: 'assistant', content: botReply }];
        try {
            await db.saveConversation({
                id: convId, timestamp: new Date().toISOString(),
                history: fullHistory, lead_data: leadData,
                sales_output: salesOutput, hubspot: hubspotResult, model_used: model
            });
        } catch (dbError) {
            console.error('❌ Failed to save to DB:', dbError.message);
        }

        // Never expose lead/sales/hubspot data to the client
        res.json({
            success: true,
            response: botReply,
            conversation_id: convId,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Server error:', error.message);
        res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
    }
});

// ─────────────────────────────────────────────
// ADMIN API ROUTES
// ─────────────────────────────────────────────
app.get('/api/admin/conversations', requireAdminSession, async (req, res) => {
    try {
        const limit        = Math.min(parseInt(req.query.limit)  || 200, 500);
        const offset       = Math.max(parseInt(req.query.offset) || 0,   0);
        const validIntents = ['High', 'Medium', 'Low'];
        const safeIntent   = validIntents.includes(req.query.intent_level) ? req.query.intent_level : undefined;
        const conversations = await db.getConversations(limit, offset, {
            intent_level: safeIntent,
            has_email:    req.query.has_email === 'true',
        });
        res.json({ conversations, total: conversations.length });
    } catch (err) {
        console.error('DB error:', err);
        res.status(500).json({ error: 'Failed to fetch conversations' });
    }
});

app.get('/api/admin/stats', requireAdminSession, async (req, res) => {
    try {
        const stats = await db.getStats();
        res.json(stats);
    } catch (err) {
        console.error('DB error:', err);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

app.get('/api/admin/conversations/:id', requireAdminSession, async (req, res) => {
    const { id } = req.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'Invalid conversation ID' });
    try {
        const conversation = await db.getConversation(id);
        if (!conversation) return res.status(404).json({ error: 'Not found' });
        res.json({ conversation });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch conversation' });
    }
});

app.delete('/api/admin/conversations/:id', requireAdminSession, async (req, res) => {
    const { id } = req.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'Invalid conversation ID' });
    try {
        await db.deleteConversation(id);
        res.json({ success: true });
    } catch (err) {
        console.error('Delete error:', err);
        res.status(500).json({ error: 'Failed to delete conversation' });
    }
});

// Health check
app.get('/test', (req, res) => res.json({
    status: 'OK', message: 'Layla is online',
    time: new Date().toISOString(),
    database:   process.env.DATABASE_URL  ? 'configured' : 'not configured',
    hubspot:    HUBSPOT_TOKEN             ? 'configured' : 'not configured',
    hubspotList: HUBSPOT_LIST_ID          ? HUBSPOT_LIST_ID : 'not configured',
}));

// Serve admin page
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ─────────────────────────────────────────────
// START
// ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

async function startServer() {
    console.log('\n🚀 Starting PLAYBOOK AI Copilot...');

    if (process.env.DATABASE_URL) {
        try {
            const ok = await db.testConnection();
            if (ok) {
                await db.initSchema();
                await db.cleanExpiredSessions();
            }
        } catch (err) {
            console.error('❌ Database startup error:', err.message);
        }
    } else {
        console.log('ℹ️  DATABASE_URL not set — no persistence');
    }

    if (!CLAUDE_API_KEY)   console.warn('⚠️  CLAUDE_API_KEY not set');
    if (!HUBSPOT_TOKEN)    console.warn('⚠️  HUBSPOT_ACCESS_TOKEN not set');
    if (!HUBSPOT_LIST_ID)  console.warn('ℹ️  HUBSPOT_LIST_ID not set — contacts won\'t be added to a list');

    app.listen(PORT, () => {
        console.log('\n' + '='.repeat(50));
        console.log('✅ PLAYBOOK AI Copilot — Layla');
        console.log('='.repeat(50));
        console.log(`📍 Chat:  http://localhost:${PORT}`);
        console.log(`🔐 Admin: http://localhost:${PORT}/admin`);
        console.log('='.repeat(50));
    });
}

startServer();