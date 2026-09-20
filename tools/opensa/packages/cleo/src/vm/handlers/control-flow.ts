/**
 * Built-in control flow (plan 097/03 decision 2): WAIT, jumps, ANDOR, gosub, CLEO_CALL frames,
 * thread naming and termination. Everything here touches only the thread — no host.
 */
import type { HandlerRegistry } from '../registry';

export function registerControlFlow(registry: HandlerRegistry): void {
  // 0000 NOP
  registry.register(0x0000, () => 'continue');

  // 0001 WAIT ms — 0 still yields until the next tick (the cooperative contract).
  registry.register(0x0001, (ctx, instruction) => {
    ctx.thread.wait(ctx.thread.readInt(instruction.operands[0]), ctx.now);

    return 'yield';
  });

  // 0002 GOTO
  registry.register(0x0002, (ctx, instruction) => {
    ctx.thread.jump(ctx.thread.readInt(instruction.operands[0]));

    return 'continue';
  });

  // 004C GOTO_IF_TRUE / 004D GOTO_IF_FALSE
  registry.register(0x004c, (ctx, instruction) => {
    if (ctx.thread.condition) {
      ctx.thread.jump(ctx.thread.readInt(instruction.operands[0]));
    }

    return 'continue';
  });
  registry.register(0x004d, (ctx, instruction) => {
    if (!ctx.thread.condition) {
      ctx.thread.jump(ctx.thread.readInt(instruction.operands[0]));
    }

    return 'continue';
  });

  // 004E TERMINATE_THIS_SCRIPT / 0A93 TERMINATE_THIS_CUSTOM_SCRIPT
  registry.register(0x004e, () => 'terminate');
  registry.register(0x0a93, () => 'terminate');

  // 004F START_NEW_SCRIPT label args… — a fresh thread on the same script.
  registry.register(0x004f, (ctx, instruction) => {
    ctx.spawnAt(ctx.thread.readInt(instruction.operands[0]), instruction.operands.slice(1));

    return 'continue';
  });

  // 0050 GOSUB / 0051 RETURN
  registry.register(0x0050, (ctx, instruction) => {
    ctx.thread.gosub(ctx.thread.readInt(instruction.operands[0]));

    return 'continue';
  });
  registry.register(0x0051, (ctx) => {
    ctx.thread.ret();

    return 'continue';
  });

  // 00D6 IF n — arms the ANDOR group the following conditionals fold into.
  registry.register(0x00d6, (ctx, instruction) => {
    ctx.thread.startAndOr(ctx.thread.readInt(instruction.operands[0]));

    return 'continue';
  });

  // 03A4 SCRIPT_NAME
  registry.register(0x03a4, (ctx, instruction) => {
    ctx.thread.name = ctx.thread.readString(instruction.operands[0]);

    return 'continue';
  });

  // 0AB1 CLEO_CALL label numArgs in… out… — gosub with a fresh local frame.
  registry.register(0x0ab1, (ctx, instruction) => {
    const target = ctx.thread.readInt(instruction.operands[0]);
    const numArgs = ctx.thread.readInt(instruction.operands[1]);
    const tail = instruction.operands.slice(2);
    ctx.thread.callWithFrame(target, tail.slice(0, numArgs), tail.slice(numArgs));

    return 'continue';
  });

  // 0AB2 CLEO_RETURN flag values… — restores the caller and copies the values out.
  registry.register(0x0ab2, (ctx, instruction) => {
    ctx.thread.returnFromCall(instruction.operands.slice(1));

    return 'continue';
  });
}
