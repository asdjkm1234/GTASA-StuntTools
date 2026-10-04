/**
 * The conformance proof (plan cleo-sdk/005): the minimal dual-target script — a wait-paced loop
 * printing five times, then clean termination. Small enough that every byte is explainable, so any
 * divergence between real CLEO and our VM is attributable. Also the example every future script
 * starts from.
 */
import { defineScript } from '../../sdk/src/dsl/script';
import { int, str } from '../../sdk/src/ir';

const PRINTS = 5;
const PERIOD_MS = 1000;

export const script = defineScript({
  budgetPerTick: 50,
  build(s) {
    const printed = s.local('printed');
    s.op('SET_LVAR_INT', printed, int(0));
    s.while(
      () => s.not('IS_INT_LVAR_GREATER_THAN_NUMBER', printed, int(PRINTS - 1)),
      () => {
        s.wait(PERIOD_MS);
        s.op('PRINT_STRING_NOW', str('HELLO OPENSA'), int(900));
        s.op('ADD_VAL_TO_INT_LVAR', printed, int(1));
      },
    );
    s.op('TERMINATE_THIS_CUSTOM_SCRIPT');
  },
  name: 'hello-conformance',
  scmName: 'hellocf',
});
