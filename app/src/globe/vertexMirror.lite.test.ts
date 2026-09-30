// The vertex mirror on every fixture family on the lite tier (streaming.md 5.6, 7.3), in a file of
// its own so it runs beside the other tier's sweep.
import { describeFixtureFamilies } from '../test/mirrorFamilies';

describeFixtureFamilies('lite');
