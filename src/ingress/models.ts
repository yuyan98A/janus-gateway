import { IncomingMessage, ServerResponse } from 'node:http';
import { Dispatcher } from '../router/dispatcher.ts';

export async function handleModels(
  req: IncomingMessage,
  res: ServerResponse,
  dispatcher: Dispatcher
) {
  try {
    const models = await dispatcher.listAllModels();
    console.info(`[Ingress:Models] Served ${models.length} models`);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(
      JSON.stringify({
        object: 'list',
        data: models
      })
    );
  } catch (err: any) {
    console.error(`[Ingress:Models] Failed to build model list: ${err.message}`);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: err.message } }));
  }
}

