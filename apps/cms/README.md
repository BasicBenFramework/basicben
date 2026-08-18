# My BasicBen App

Built with [BasicBen](https://github.com/BasicBenFramework/core) — a full-stack React framework with zero runtime dependencies.

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view your app.

## Commands

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run start        # Run production server
npm run test         # Run tests

npm run migrate      # Run database migrations
npm run migrate:fresh   # Reset and re-run all migrations
```

## Project Structure

```
src/
├── main.jsx              # React entry point
├── routes/
│   ├── App.jsx           # Client routes
│   └── api/              # API routes (auto-loaded)
├── controllers/          # Business logic
├── models/               # Database queries
├── middleware/           # Route middleware
├── helpers/              # Utility functions
└── client/
    ├── layouts/          # Layout components
    ├── pages/            # Page components
    └── components/       # Reusable UI
```

## Scaffolding

```bash
npx basicben make:controller User
npx basicben make:model User
npx basicben make:route users
npx basicben make:migration create_users
```

## Configuration

Edit `basicben.config.js` to customize server settings, CORS, database, and more.

## Documentation

Full documentation: [github.com/BasicBenFramework/core](https://github.com/BasicBenFramework/core)
