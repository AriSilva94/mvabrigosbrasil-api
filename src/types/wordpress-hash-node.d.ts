declare module 'wordpress-hash-node' {
  const wordpressHash: {
    HashPassword(password: string): string;
    CheckPassword(password: string, hash: string): boolean;
  };
  export default wordpressHash;
}
