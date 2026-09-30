// What stays reachable, for the tests that check a module lets go of what it no longer needs: a
// full collection through V8's gc, which a new context holds once the flag is set.
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as () => void;

/** How many of `refs`' targets outlive a full collection, run once the current job has ended. */
export async function survivors(refs: readonly WeakRef<object>[]): Promise<number> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  gc();
  return refs.filter((ref) => ref.deref() !== undefined).length;
}
