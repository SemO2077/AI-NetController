## Summary
Describe the changes and the affected component(s) (`agent/`, `apps/web/`, `apps/mobile/`, `docs/`, `scripts/`).

## Checklist
- [ ] Protocol / opcode changes remain consistent across Python, TypeScript, and Dart (`docs/PROTOCOL.md`)
- [ ] No hardcoded secrets, PINs, or unauthenticated control routes introduced
- [ ] `npm run lint` and `npm test` pass (`apps/web/`)
- [ ] `python -m unittest discover -s agent/tests` passes (`agent/`)
- [ ] `flutter analyze` and `flutter test test/` pass (`apps/mobile/`, when applicable)
- [ ] Documentation or release notes updated if behavior changed
