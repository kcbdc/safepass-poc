// Minimal D1 ambient API for offline TypeScript checks. Runtime provided by Cloudflare Workers.
interface D1Database {
 prepare(query:string):D1PreparedStatement;
 batch<T = unknown>(statements:D1PreparedStatement[]):Promise<D1Result<T>[]>;
}
interface D1PreparedStatement {
 bind(...values:unknown[]):D1PreparedStatement;
 first<T=Record<string,unknown>>():Promise<T|null>;
 all<T=Record<string,unknown>>():Promise<D1Result<T>>;
 run<T=Record<string,unknown>>():Promise<D1Result<T>>;
}
interface D1Result<T=unknown>{ results:T[]; meta:{changes:number}; success:boolean }
