// Imported first by worker.ts so the role is set before AppModule loads
// (the config reads PROCESS_ROLE at that moment). M7-7.
process.env.PROCESS_ROLE = 'worker';
