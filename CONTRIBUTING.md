# Contributing

1. Open an issue describing the bug or feature and its local fixture.
2. Keep changes focused and readable; extension code must remain self-contained and must not execute remote code.
3. Add tests for parser, security-boundary, or lifecycle changes.
4. Run:

   ```bash
   npm test
   python3 -m unittest discover -s native-host/tests -v
   python3 scripts/validate.py
   ```

5. Do not include third-party extension code, production authentication data, browser profiles, copyrighted media, signing keys, or generated download output.

By contributing, you agree that your contribution is licensed under the repository's MIT License.
