# PLAYBOOK AI Sales Copilot — Raya

An intelligent AI-powered sales assistant that engages with potential members, captures lead data, analyzes conversation sentiment, and syncs with HubSpot CRM.

## 🚀 Features

- **AI-Powered Conversations**: Natural language interactions using Claude AI
- **Lead Intelligence**: Automatic extraction of lead data, intent levels, and conversation vibes
- **HubSpot Integration**: Auto-create contacts and add conversation notes
- **Admin Dashboard**: Real-time monitoring of all conversations with detailed analytics
- **Persistent Storage**: PostgreSQL database (Neon/Supabase) for conversation history
- **Dark/Light Mode**: Full theme support with system preference detection
- **Responsive Design**: Works on desktop and mobile devices

## 📋 Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Database Setup](#database-setup)
- [Running the Application](#running-the-application)
- [Project Structure](#project-structure)
- [API Endpoints](#api-endpoints)
- [HubSpot Integration](#hubspot-integration)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- PostgreSQL database (Neon, Supabase, or local)
- Claude API key (Anthropic)
- HubSpot account (for CRM integration)

## Installation

1. **Clone the repository**
git clone https://github.com/yourusername/ai-sales-copilot.git
cd ai-sales-copilot

2. **Install dependencies**
npm install

3. **Set up environment variables**
Create a .env file in the root directory with the following variables:
- Database (Required)
DATABASE_URL=postgresql://username:password@host:port/database?sslmode=require

- API Keys (Required)
CLAUDE_API_KEY=your_anthropic_claude_api_key
HUBSPOT_ACCESS_TOKEN=your_hubspot_private_app_token

- Admin 
ADMIN_TOKEN= ENTERPASSWORDHERE

- Environment
NODE_ENV=development
PORT=3000

## Getting API Keys
1. Claude API Key;
- Sign up at Anthropic Console
- Generate an API key with access to Claude models

2. HubSpot Access Token
- Go to HubSpot Settings → Integrations → Private Apps
- Create a new private app with these scopes:
``crm.objects.contacts.read``
``crm.objects.contacts.write``
- Copy the access token

3. Database Setup
- Create a free account at Neon.tech
- Create a new project
- Copy the connection string
- Add to your .env file

## Running the Application
``npm start``

Access the Application;
- Chat Interface: http://localhost:3000
- Admin Dashboard: http://localhost:3000/admin

