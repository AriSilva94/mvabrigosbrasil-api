function arraysShallowEqual(a: unknown[], b: unknown[]) {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

export function hasChanges(
  current: Record<string, unknown> | null,
  incoming: Record<string, unknown>,
): boolean {
  if (!current) return true;

  return Object.entries(incoming).some(([key, incomingValue]) => {
    const currentValue = key in current ? current[key] : undefined;

    if (Array.isArray(currentValue) || Array.isArray(incomingValue)) {
      const currentArray = Array.isArray(currentValue) ? currentValue : [];
      const incomingArray = Array.isArray(incomingValue) ? incomingValue : [];
      return !arraysShallowEqual(currentArray, incomingArray);
    }

    return (currentValue ?? null) !== (incomingValue ?? null);
  });
}
