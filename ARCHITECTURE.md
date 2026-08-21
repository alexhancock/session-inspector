# Session Inspector Architecture

This is a session inspector for agentic sessions (Claude Code, goose, etc)

The technical architecture and priorities are as follows:

- Single HTML file distributable, build from vite + ts + react
- Uses vite, react, and typescript in the simplest possible configuration
- Uses libraries when they provide a lot of value and don't stipulate much
  about how the rest of the app is written
- Relies on simple package.json script entries for key actions (dev, test, build, deploy)
- Has simple TS modules, using classes if it makes sense, to separate concerns
- Uses simple Vercel config to deploy to static hosting
- Can support sessions from multiple agents. Sessions will be imported as json or jsonl files
  but be represented in the program by a module that implements an interface. Any agent session
  types we want to add in the future can implement this interface to participate abstracting over
  the underlying json
