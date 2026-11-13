## Summary
Summarize the changes in this merge request and which modules are touched (`agent/`, `apps/web/`, `apps/mobile/`, `docs/`, `scripts/`).

## Verification
- [ ] Web checks pass (`npm run lint`, `npm test`, `npm run build`)
- [ ] Agent test suite passes (`python -m unittest discover -s agent/tests`)
- [ ] Mobile analysis & tests pass (`flutter analyze`, `flutter test test/`)
- [ ] Protocol changes synchronized across Python, TypeScript, and Dart (`docs/PROTOCOL.md`)
- [ ] No credentials, secrets, or local filesystem paths introduced
