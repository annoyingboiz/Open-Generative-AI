import { config } from './config.js';
import { buildApp } from './app.js';

const app = await buildApp(config);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
}

await app.listen({ host: config.host, port: config.port });
app.log.info(`Gateway on http://${config.host}:${config.port} → studio ${config.studioUrl}, data ${config.dataDir}`);
