# Telegram Broadcast Worker

A production-ready Node.js + TypeScript worker for handling Telegram broadcasts. Designed to run 24/7 on Railway alongside a Next.js application hosted on Vercel.

## Features

- 🚀 TypeScript with strict type checking
- 📦 Supabase integration for database operations
- 🤖 Telegram Bot API integration
- 🔄 Automatic broadcast processing with batch support
- 🛡️ Duplicate prevention - never sends same broadcast twice
- ⏱️ Rate limiting with configurable delays
- 🔁 Automatic retry for temporary Telegram errors
- 📊 Real-time progress tracking
- 🛑 Graceful shutdown handling
- 📝 Comprehensive logging
- 🏗️ Clean architecture with separation of concerns

## Prerequisites

- Node.js >= 18.0.0
- npm or yarn
- Supabase project with required tables
- Telegram Bot Token

## Database Schema

The worker expects these tables to exist:

### `users`
- `telegram_id` (number)
- `status` (string)

### `broadcast_logs`
- `id` (number)
- `message` (text)
- `image_url` (text, nullable)
- `status` (text: 'pending', 'running', 'completed', 'failed')
- `total_users` (number)
- `success_count` (number)
- `failed_count` (number)
- `created_at` (timestamp)

### `broadcast_sent`
- `broadcast_id` (number)
- `telegram_id` (number)
- `sent_at` (timestamp)

## Environment Variables

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
