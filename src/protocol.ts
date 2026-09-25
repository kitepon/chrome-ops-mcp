export type RequestMessage = { id: string; type: "request"; method: string; params?: unknown };
export type ResponseMessage = { id: string; type: "response"; ok: boolean; result?: unknown; error?: string };
export type EventMessage = { type: "event"; event: string; data: unknown };
export type BridgeMessage = RequestMessage | ResponseMessage | EventMessage;
