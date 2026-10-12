// Minimal D1 type declarations for portable TypeScript checks without installed Wrangler types.
interface D1Result {meta:{changes:number};results:Record<string,unknown>[]}
interface D1PreparedStatement {
 bind(...values:unknown[]):D1PreparedStatement;
 run():Promise<D1Result>;
 first<T=Record<string,unknown>>():Promise<T|null>;
 all():Promise<D1Result>;
}
interface D1Database {
 prepare(query:string):D1PreparedStatement;
 batch(statements:D1PreparedStatement[]):Promise<D1Result[]>;
}
