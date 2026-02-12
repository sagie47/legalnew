# Agent Coding Guidelines

## Build, Lint, and Test Commands

### Development
```bash
npm run dev           # Start frontend (Vite dev server on port 3000)
npm run dev:server    # Start backend (Express server on port 3001)
npm run build         # Build frontend for production
npm run preview       # Preview production build
```

### Testing (Server Only)
```bash
# Run all server tests
npm run test:server

# Run a single test file
node --test server/ingest/pdi/__tests__/chunk.test.js

# Run a specific test within a file
node --test --test-name-pattern="chunks text with overlap" server/ingest/pdi/__tests__/chunk.test.js
```

## Project Structure

- `server/` - Express backend (ES modules, .js files)
- `components/` - React components (TypeScript .tsx)
- `lib/` - Frontend utilities, types, store, API client
- `scripts/` - Scraper and utility scripts

## Code Style Guidelines

### General
- Use ES modules (`import`/`export`) throughout
- Add `.js` extension to relative imports in backend code
- Use path aliases (`@/*`) in frontend (`@/components`, `@/lib`)
- Prefer async/await over raw promises

### Backend (Node.js/Express)
- Use `node:` protocol for Node built-ins: `import { randomUUID } from 'node:crypto';`
- Use `camelCase` for functions and variables
- Keep files under 300 lines; extract helpers to separate modules
- Use early returns to reduce nesting

### Frontend (React/TypeScript)
- Use TypeScript interfaces for all data structures (`lib/types.ts`)
- Use `React.FC<Props>` for component typing
- Prefer functional components with hooks
- Use Tailwind CSS classes for styling (no CSS files)
- Use `cn()` utility for conditional class merging

### Naming Conventions
- **Files**: `camelCase.js` for backend, `PascalCase.tsx` for React components
- **Functions**: `camelCase` (e.g., `retrieveGrounding`, `chunkSections`)
- **Constants**: `UPPER_SNAKE_CASE` for true constants
- **React Components**: `PascalCase` (e.g., `MessageBubble`, `SourcesPanel`)
- **Interfaces**: `PascalCase` with descriptive names (e.g., `CitationReference`)

### Imports Ordering
1. Node built-ins (`node:` protocol)
2. External packages (e.g., `express`, `react`)
3. Relative imports (local modules)
4. Path aliases (`@/`)

```javascript
// Backend example
import express from 'express';
import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import { groqAnswer } from './clients/groq.js';
import { retrieveGrounding } from './rag/grounding.js';
```

### Error Handling
- Always wrap async route handlers in try/catch
- Log errors with `console.error` including error message
- Return appropriate HTTP status codes (400 for bad input, 500 for server errors)
- Never expose internal error details to clients

```javascript
app.post('/api/endpoint', async (req, res) => {
  try {
    const result = await doSomething(req.body);
    return res.json(result);
  } catch (error) {
    console.error('Endpoint error:', error);
    return res.status(500).json({ error: 'User-friendly message' });
  }
});
```

### TypeScript Patterns
- Define shared types in `lib/types.ts`
- Use explicit return types for complex functions
- Prefer `interface` over `type` for object shapes
- Use `any` sparingly; prefer `unknown` when type is uncertain

### Testing
- Use Node's built-in test runner (`node:test`)
- Use `assert/strict` for assertions
- Place tests in `__tests__/` directory alongside source
- Test file naming: `sourceFile.test.js`

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { myFunction } from '../myModule.js';

test('describe what is tested', () => {
  const result = myFunction(input);
  assert.equal(result, expected);
});
```

### Security
- Never log secrets or API keys
- Sanitize user input before using in prompts (see `server/rag/security.js`)
- Validate all API inputs
- Use environment variables for configuration

### Environment Variables
Required variables:
- `GROQ_API_KEY`, `GROQ_MODEL` - LLM configuration
- `PINECONE_API_KEY`, `PINECONE_INDEX_HOST`, `PINECONE_NAMESPACE` - Vector DB
- `DATABASE_URL` - Optional, enables persistence
- `A2AJ_*` - Case law API (optional)

### Key Backend Patterns

**Citation System**:
- Sources from Pinecone labeled `P1, P2, ...`
- Sources from A2AJ labeled `C1, C2, ...`
- Always validate citation tokens before responding
- Use `validateCitationTokens()` to remove invalid citations

**Route Handler Pattern**:
- Always validate required fields first
- Resolve auth/user info early
- Use helper functions for complex logic
- Return consistent response structure

### Key Frontend Patterns

**Component Props**:
```typescript
export const MyComponent: React.FC<{
  message: Message;
  onCitationOpen?: (citation: CitationReference) => void;
}> = ({ message, onCitationOpen }) => {
  // implementation
};
```

**State Management**:
- Use Zustand store (`lib/store.tsx`) for global state
- Access via `useAppStore()` hook
- Dispatch actions via `dispatch({ type: 'ACTION' })`
