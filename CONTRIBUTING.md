# Contributing to AI NetController

Thank you for your interest in contributing!

## Development Workflow

1. Fork the repository and create a feature branch:
   ```bash
   git checkout -b feature/my-cool-feature
   ```

2. Install Node.js dependencies for the web console:
   ```bash
   npm install
   ```

3. Run verification test suites before opening a Pull Request:
   ```bash
   # Web Verification & Stress Suites
   npm test

   # TypeScript Linting & Type Checks
   npm run lint

   # Python Agent Test Harnesses
   python agent/tests/test_all_edge_cases.py
   python agent/tests/test_host_diagnostics.py
   ```

## Code Conventions

* **TypeScript / React**: Use functional components, Zustand store state slices, and Tailwind CSS v4 styling.
* **Python**: Follow PEP 8 style guidelines and type annotations.
* **Flutter**: Adhere to official Dart style guidelines and Riverpod state patterns.

## Pull Request Guidelines

* Ensure all 34 Verification Pillars and 13 Stress Tests pass with zero errors.
* Include clear PR descriptions highlighting architectural changes or bug fixes.
