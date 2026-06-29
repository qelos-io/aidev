# Contributing

Contributions are welcome — new providers, new AI runners, bug fixes, and docs improvements.

## Getting started

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Build and test: `npm install && npm run build && npm test`
5. Open a pull request

## Development setup

```bash
git clone https://github.com/qelos-io/aidev
cd aidev
npm install
npm run dev -- init
npm run dev -- run --help
```

## Documentation

The full documentation site lives in `documentation/`. To work on it locally:

```bash
cd documentation
npm install
npm run dev
```

## Adding a provider

1. Create `src/providers/<name>.ts` implementing the `TaskProvider` interface
2. Register it in `src/providers/index.ts`
3. Add config keys to `src/types.ts` and `src/config.ts`
4. Document env vars in `.env.aidev.example` and the docs site

## Adding an AI runner

1. Create `src/ai/<name>.ts` implementing the `AIRunner` interface
2. Register in `src/ai/index.ts`
3. Document in the [AI agents](/guide/agents) page

See [CONTRIBUTING.md](https://github.com/qelos-io/aidev/blob/main/CONTRIBUTING.md) in the repository for the full guide.

## License

[MIT](https://github.com/qelos-io/aidev/blob/main/LICENSE)
