/** "p001"... Permanent: never renumbered or reused (PROJECT.md 4.1). */
export type PlayerId = string;
export type TeamId = string;
/** Opaque. Accounts vs guest ids is an M4 decision. */
export type ParticipantId = string;
export type GameId = string;

/** Integer lakhs. Never a float. */
export type Lakhs = number;
/** Epoch milliseconds. Always injected via actions, never read inside the engine. */
export type Millis = number;
