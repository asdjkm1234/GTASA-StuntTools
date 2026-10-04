/**
 * World handlers (plan 097/03 decision 1): the corpus opcodes with engine meaning, each a thin call
 * onto a `CleoHost` facet. The VM stays engine-agnostic — plan 04 implements the host over the real
 * engine; tests record a mock. Native-call/memory opcodes (0AA5-0AA8, 0A8C-0A8E, 0A97, 0AEB) are
 * NOT here — plan 05's atlas domain serves those.
 */
import type { HandlerRegistry } from '../registry';

export function registerWorld(registry: HandlerRegistry): void {
  registerPlayer(registry);
  registerModels(registry);
  registerObjects(registry);
  registerVehicles(registry);
  registerQueries(registry);
}

function registerModels(registry: HandlerRegistry): void {
  // 0247 REQUEST_MODEL / 0248 HAS_MODEL_LOADED / 0249 MARK_MODEL_AS_NO_LONGER_NEEDED
  registry.register(0x0247, (ctx, instruction) => {
    ctx.host.models.request(ctx.thread.readInt(instruction.operands[0]));

    return 'continue';
  });
  registry.register(0x0248, (ctx, instruction) => {
    ctx.thread.setCondition(
      ctx.host.models.isAvailable(ctx.thread.readInt(instruction.operands[0])),
      instruction.negated,
    );

    return 'continue';
  });
  registry.register(0x0249, (ctx, instruction) => {
    ctx.host.models.markUnneeded(ctx.thread.readInt(instruction.operands[0]));

    return 'continue';
  });
  // 0E9C GET_MODEL_BY_NAME name out — the condition is "a model carries this name".
  registry.register(0x0e9c, (ctx, instruction) => {
    const model = ctx.host.models.byName(ctx.thread.readString(instruction.operands[0]));
    ctx.thread.writeInt(instruction.operands[1], model ?? -1);
    ctx.thread.setCondition(model !== null, instruction.negated);

    return 'continue';
  });
  // 0EF8 GET_MODEL_INFO model out — an opaque token (plan 05 reads it); condition = non-zero.
  registry.register(0x0ef8, (ctx, instruction) => {
    const info = ctx.host.models.info(ctx.thread.readInt(instruction.operands[0]));
    ctx.thread.writeInt(instruction.operands[1], info);
    ctx.thread.setCondition(info !== 0, instruction.negated);

    return 'continue';
  });
}

function registerObjects(registry: HandlerRegistry): void {
  // 0E01 CREATE_OBJECT_NO_SAVE model x y z ? ? out (the two flag operands ride along unread —
  // recorded in the plan 03 ledger; the corpus always passes 0 0).
  registry.register(0x0e01, (ctx, instruction) => {
    const handle = ctx.host.objects.create(
      ctx.thread.readInt(instruction.operands[0]),
      ctx.thread.readFloat(instruction.operands[1]),
      ctx.thread.readFloat(instruction.operands[2]),
      ctx.thread.readFloat(instruction.operands[3]),
    );
    ctx.thread.writeInt(instruction.operands[6], handle);

    return 'continue';
  });
  registry.register(0x0108, (ctx, instruction) => {
    ctx.host.objects.delete(ctx.thread.readInt(instruction.operands[0]));

    return 'continue';
  });
  registry.register(0x03ca, (ctx, instruction) => {
    ctx.thread.setCondition(ctx.host.objects.exists(ctx.thread.readInt(instruction.operands[0])), instruction.negated);

    return 'continue';
  });
  // 0453 SET_OBJECT_ROTATION obj rx ry rz (degrees)
  registry.register(0x0453, (ctx, instruction) => {
    ctx.host.objects.setRotation(
      ctx.thread.readInt(instruction.operands[0]),
      ctx.thread.readFloat(instruction.operands[1]),
      ctx.thread.readFloat(instruction.operands[2]),
      ctx.thread.readFloat(instruction.operands[3]),
    );

    return 'continue';
  });
  registry.register(0x0177, (ctx, instruction) => {
    ctx.host.objects.setHeading(
      ctx.thread.readInt(instruction.operands[0]),
      ctx.thread.readFloat(instruction.operands[1]),
    );

    return 'continue';
  });
  registry.register(0x01bc, (ctx, instruction) => {
    ctx.host.objects.setCoordinates(
      ctx.thread.readInt(instruction.operands[0]),
      ctx.thread.readFloat(instruction.operands[1]),
      ctx.thread.readFloat(instruction.operands[2]),
      ctx.thread.readFloat(instruction.operands[3]),
    );

    return 'continue';
  });
  registry.register(0x01bb, (ctx, instruction) => {
    const [x, y, z] = ctx.host.objects.getCoordinates(ctx.thread.readInt(instruction.operands[0]));
    ctx.thread.writeFloat(instruction.operands[1], x);
    ctx.thread.writeFloat(instruction.operands[2], y);
    ctx.thread.writeFloat(instruction.operands[3], z);

    return 'continue';
  });
  // 0400 GET_OFFSET_FROM_OBJECT_IN_WORLD_COORDS obj x y z outX outY outZ
  registry.register(0x0400, (ctx, instruction) => {
    const [x, y, z] = ctx.host.objects.offsetInWorldCoords(
      ctx.thread.readInt(instruction.operands[0]),
      ctx.thread.readFloat(instruction.operands[1]),
      ctx.thread.readFloat(instruction.operands[2]),
      ctx.thread.readFloat(instruction.operands[3]),
    );
    ctx.thread.writeFloat(instruction.operands[4], x);
    ctx.thread.writeFloat(instruction.operands[5], y);
    ctx.thread.writeFloat(instruction.operands[6], z);

    return 'continue';
  });
  // 0827 CONNECT_LODS near far
  registry.register(0x0827, (ctx, instruction) => {
    ctx.host.objects.connectLods(
      ctx.thread.readInt(instruction.operands[0]),
      ctx.thread.readInt(instruction.operands[1]),
    );

    return 'continue';
  });
}

function registerPlayer(registry: HandlerRegistry): void {
  // 01F5 GET_PLAYER_CHAR player out
  registry.register(0x01f5, (ctx, instruction) => {
    ctx.thread.writeInt(
      instruction.operands[1],
      ctx.host.player.playerChar(ctx.thread.readInt(instruction.operands[0])),
    );

    return 'continue';
  });
  registry.register(0x0256, (ctx, instruction) => {
    ctx.thread.setCondition(
      ctx.host.player.isPlaying(ctx.thread.readInt(instruction.operands[0])),
      instruction.negated,
    );

    return 'continue';
  });
  // 056D DOES_CHAR_EXIST char
  registry.register(0x056d, (ctx, instruction) => {
    ctx.thread.setCondition(ctx.host.player.exists(ctx.thread.readInt(instruction.operands[0])), instruction.negated);

    return 'continue';
  });
  // 00A0 GET_CHAR_COORDINATES char outX outY outZ
  registry.register(0x00a0, (ctx, instruction) => {
    const [x, y, z] = ctx.host.player.charCoordinates(ctx.thread.readInt(instruction.operands[0]));
    ctx.thread.writeFloat(instruction.operands[1], x);
    ctx.thread.writeFloat(instruction.operands[2], y);
    ctx.thread.writeFloat(instruction.operands[3], z);

    return 'continue';
  });
}

function registerQueries(registry: HandlerRegistry): void {
  registry.register(0x0485, (ctx, instruction) => {
    ctx.thread.setCondition(ctx.host.world.isPcVersion(), instruction.negated);

    return 'continue';
  });
  registry.register(0x0aa9, (ctx, instruction) => {
    ctx.thread.setCondition(ctx.host.world.isGameVersionOriginal(), instruction.negated);

    return 'continue';
  });
  // 0EBE LOCATE_CAMERA_DISTANCE_TO_COORDINATES x y z radius
  registry.register(0x0ebe, (ctx, instruction) => {
    const within = ctx.host.world.cameraWithin(
      ctx.thread.readFloat(instruction.operands[0]),
      ctx.thread.readFloat(instruction.operands[1]),
      ctx.thread.readFloat(instruction.operands[2]),
      ctx.thread.readFloat(instruction.operands[3]),
    );
    ctx.thread.setCondition(within, instruction.negated);

    return 'continue';
  });
  registry.register(0x0e40, (ctx, instruction) => {
    ctx.thread.writeInt(instruction.operands[0], ctx.host.world.currentHour());

    return 'continue';
  });
  registry.register(0x077e, (ctx, instruction) => {
    ctx.thread.writeInt(instruction.operands[0], ctx.host.world.visibleArea());

    return 'continue';
  });
  // 024F DRAW_CORONA x y z size coronaType flareType r g b
  registry.register(0x024f, (ctx, instruction) => {
    const floats = instruction.operands.slice(0, 4).map((operand) => ctx.thread.readFloat(operand));
    const ints = instruction.operands.slice(4).map((operand) => ctx.thread.readInt(operand));
    ctx.host.world.drawCorona(floats[0], floats[1], floats[2], floats[3], ints[0], ints[1], ints[2], ints[3], ints[4]);

    return 'continue';
  });
  // 0ACD PRINT_STRING_NOW text ms
  registry.register(0x0acd, (ctx, instruction) => {
    ctx.host.text.printNow(ctx.thread.readString(instruction.operands[0]), ctx.thread.readInt(instruction.operands[1]));

    return 'continue';
  });
}

function registerVehicles(registry: HandlerRegistry): void {
  // 0137 IS_CAR_MODEL car model
  registry.register(0x0137, (ctx, instruction) => {
    const model = ctx.host.vehicles.carModel(ctx.thread.readInt(instruction.operands[0]));
    ctx.thread.setCondition(model === ctx.thread.readInt(instruction.operands[1]), instruction.negated);

    return 'continue';
  });
  registry.register(0x0441, (ctx, instruction) => {
    ctx.thread.writeInt(
      instruction.operands[1],
      ctx.host.vehicles.carModel(ctx.thread.readInt(instruction.operands[0])),
    );

    return 'continue';
  });
  registry.register(0x00db, (ctx, instruction) => {
    const inCar = ctx.host.vehicles.isCharInCar(
      ctx.thread.readInt(instruction.operands[0]),
      ctx.thread.readInt(instruction.operands[1]),
    );
    ctx.thread.setCondition(inCar, instruction.negated);

    return 'continue';
  });
  registry.register(0x00df, (ctx, instruction) => {
    ctx.thread.setCondition(
      ctx.host.vehicles.isCharInAnyCar(ctx.thread.readInt(instruction.operands[0])),
      instruction.negated,
    );

    return 'continue';
  });
  // 0A01 IS_THIS_MODEL_A_CAR model
  registry.register(0x0a01, (ctx, instruction) => {
    ctx.thread.setCondition(
      ctx.host.vehicles.isCarModel(ctx.thread.readInt(instruction.operands[0])),
      instruction.negated,
    );

    return 'continue';
  });
  // 03C0 STORE_CAR_CHAR_IS_IN_NO_SAVE char out
  registry.register(0x03c0, (ctx, instruction) => {
    ctx.thread.writeInt(
      instruction.operands[1],
      ctx.host.vehicles.storeCarCharIsIn(ctx.thread.readInt(instruction.operands[0])),
    );

    return 'continue';
  });
  // 046C GET_DRIVER_OF_CAR car out — -1 when empty (scripts compare against the char handle).
  registry.register(0x046c, (ctx, instruction) => {
    const driver = ctx.host.vehicles.driverOf(ctx.thread.readInt(instruction.operands[0]));
    ctx.thread.writeInt(instruction.operands[1], driver ?? -1);

    return 'continue';
  });
  // 0AE2 GET_RANDOM_CAR_IN_SPHERE_NO_SAVE_RECURSIVE x y z radius findNext skipWrecked out
  registry.register(0x0ae2, (ctx, instruction) => {
    const car = ctx.host.vehicles.carInSphere(
      ctx.thread.readFloat(instruction.operands[0]),
      ctx.thread.readFloat(instruction.operands[1]),
      ctx.thread.readFloat(instruction.operands[2]),
      ctx.thread.readFloat(instruction.operands[3]),
      ctx.thread.readInt(instruction.operands[4]) !== 0,
      ctx.thread.readInt(instruction.operands[5]) !== 0,
    );
    ctx.thread.writeInt(instruction.operands[6], car ?? -1);
    ctx.thread.setCondition(car !== null, instruction.negated);

    return 'continue';
  });
  // 0EA8 GET_ANY_CAR_NO_SAVE_RECURSIVE progress outProgress outCar
  registry.register(0x0ea8, (ctx, instruction) => {
    const found = ctx.host.vehicles.anyCar(ctx.thread.readInt(instruction.operands[0]));
    ctx.thread.writeInt(instruction.operands[1], found ? found.progress : 0);
    ctx.thread.writeInt(instruction.operands[2], found ? found.car : -1);
    ctx.thread.setCondition(found !== null, instruction.negated);

    return 'continue';
  });
}
