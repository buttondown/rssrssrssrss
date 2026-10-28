// The Workers Cache API. It is undefined outside the Workers runtime.
export function edgeCache(): Cache | undefined {
  return typeof caches === "undefined"
    ? undefined
    : (caches as unknown as { default: Cache }).default;
}
