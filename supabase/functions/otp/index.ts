import { createOtpHandler } from './handler.mjs';

Deno.serve(createOtpHandler({ env: (name: string) => Deno.env.get(name) }));
