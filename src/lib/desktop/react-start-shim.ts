type ServerFunction<TArgs extends unknown[], TResult> = (...args: TArgs) => Promise<TResult>;

export function useServerFn<TArgs extends unknown[], TResult>(
  fn: ServerFunction<TArgs, TResult>,
): ServerFunction<TArgs, TResult> {
  return fn;
}
