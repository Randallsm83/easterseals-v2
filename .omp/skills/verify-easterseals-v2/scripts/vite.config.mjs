// The repo's client/vite.config.ts with the optimizer cache moved out of the checkout.
import { mergeConfig } from 'vite';
import base from '../../../../client/vite.config.ts';

export default mergeConfig(base, { cacheDir: process.env.ES_VITE_CACHE });
