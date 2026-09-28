// Vitest runs the tests through Vite, which takes the CSS a module imports (the faces in
// story/ui/fonts.ts) as the app's build does, so the tests' type check takes it too.
declare module '*.css';
