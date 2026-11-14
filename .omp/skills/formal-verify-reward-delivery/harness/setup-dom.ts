import { GlobalRegistrator } from '@happy-dom/global-registrator';

// The runner under test is a React page; this gives it a DOM. The host never resolves.
GlobalRegistrator.register({ url: 'http://reward-delivery.invalid/' });
