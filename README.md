# Factory Simulator with AI Assistance

An AI-powered factory simulation application built with React, TypeScript, and Express.

## Features

- Interactive factory simulation with real-time state updates
- AI assistant powered by OpenAI for factory management
- Server-Sent Events (SSE) for real-time data streaming
- Production-ready build configuration
- Docker support for easy deployment

## Prerequisites

- Node.js 20 or higher
- npm or yarn
- OpenAI API key

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Configuration

Copy the example environment file and configure your settings:

```bash
cp .env.example .env
```

Edit `.env` and add your OpenAI API key:

```
OPENAI_API_KEY=your_actual_api_key_here
PORT=3000
NODE_ENV=development
```

### 3. Development

Run both the client and server in development mode:

```bash
npm run dev:all
```

Or run them separately:

```bash
# Terminal 1 - Client (Vite dev server on port 5173)
npm run dev

# Terminal 2 - Server (Express on port 3000)
npm run dev:server
```

The application will be available at:
- Frontend: http://localhost:5173
- Backend API: http://localhost:3000
- Health check: http://localhost:3000/api/health

## Production Deployment

### 1. Build for Production

```bash
npm run build
```

This builds both the client and server into the `dist` directory:
- `dist/client/` - Frontend static files
- `dist/server/` - Compiled server code

### 2. Start Production Server

```bash
NODE_ENV=production npm start
```

The server will:
- Serve the static frontend files
- Provide API endpoints on port 3000 (or PORT from environment)
- Handle all client-side routing

### 3. Production Environment Variables

For production deployment, set these environment variables:

```bash
NODE_ENV=production
PORT=3000
OPENAI_API_KEY=your_api_key
CORS_ORIGIN=https://yourdomain.com  # Optional, for specific CORS origin
```

## Docker Deployment

### Build Docker Image

```bash
docker build -t factory-simulator .
```

### Run Docker Container

```bash
docker run -p 3000:3000 \
  -e OPENAI_API_KEY=your_api_key \
  -e NODE_ENV=production \
  factory-simulator
```

### Docker Compose (Optional)

Create a `docker-compose.yml`:

```yaml
version: '3.8'
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - OPENAI_API_KEY=${OPENAI_API_KEY}
    restart: unless-stopped
```

Run with:

```bash
docker-compose up -d
```

## API Endpoints

- `GET /api/health` - Health check endpoint
- `GET /api/factory/params` - Get factory parameters
- `POST /api/factory/params` - Update factory parameters
- `GET /api/factory/state` - Get current factory state
- `POST /api/factory/start` - Start simulation
- `POST /api/factory/stop` - Stop simulation
- `POST /api/factory/reset` - Reset simulation
- `GET /api/factory/stream` - SSE endpoint for real-time updates
- `POST /api/factory/chat-aisdk` - AI chat endpoint

## Project Structure

```
.
├── src/                    # Frontend React application
├── server/                 # Backend Express server
│   ├── index.ts           # Main server file
│   ├── FactorySimulation.ts
│   ├── factoryAgent.ts
│   └── factoryTools.ts
├── dist/                   # Production build output
│   ├── client/            # Built frontend
│   └── server/            # Compiled backend
├── tsconfig.json          # TypeScript config for frontend
├── tsconfig.server.json   # TypeScript config for backend
├── vite.config.ts         # Vite configuration
└── Dockerfile             # Docker configuration

```

## Scripts

- `npm run dev` - Start Vite dev server
- `npm run dev:server` - Start server in watch mode
- `npm run dev:all` - Start both client and server
- `npm run build` - Build both client and server for production
- `npm run build:client` - Build frontend only
- `npm run build:server` - Build backend only
- `npm start` - Start production server
- `npm run preview` - Preview production build locally

## Troubleshooting

### Build fails
- Ensure all dependencies are installed: `npm install`
- Check TypeScript version compatibility
- Verify Node.js version (20+)

### API key errors
- Verify OPENAI_API_KEY is set in `.env`
- Check API key has proper permissions

### Port already in use
- Change PORT in `.env` file
- Kill existing process: `lsof -ti:3000 | xargs kill`

## License

ISC
