# Portable Node.js Rule

Always use the portable Node.js environment located at `C:\Alekos\Tools\node24portable`.

- When executing shell commands, always prepend `C:\Alekos\Tools\node24portable` to `$env:PATH` (PowerShell) or `%PATH%` (CMD), or invoke `C:\Alekos\Tools\node24portable\npm.cmd`, `npx.cmd`, or `node.exe` directly.
- All VS Code tasks, terminal sessions, and AI agent operations must default to this portable path.
