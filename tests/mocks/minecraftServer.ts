export const registeredBeforeEvents = new Map<string, Function[]>();
export const registeredAfterEvents = new Map<string, Function[]>();
export const scheduledIntervals: { id: number; callback: Function; interval: number }[] = [];
export const scheduledTimeouts: { id: number; callback: Function; timeout: number }[] = [];
export const activeJobs: Generator<void, void, unknown>[] = [];
export const activeJobEntries = new Map<number, Generator<void, void, unknown>>();
export const commandFeedbackWrites: boolean[] = [];

export const mockPlayers: any[] = [];
export const mockEntities = new Map<string, any>();
export const mockDynamicProperties = new Map<string, any>();

export const mockSpawnedItems: MockItemEntity[] = [];

export let nextRunId = 1;

let mockSendCommandFeedback = true;

export function resetMocks(): void {
    registeredBeforeEvents.clear();
    registeredAfterEvents.clear();
    scheduledIntervals.length = 0;
    scheduledTimeouts.length = 0;
    activeJobs.length = 0;
    activeJobEntries.clear();
    commandFeedbackWrites.length = 0;
    mockSendCommandFeedback = true;
    mockPlayers.length = 0;
    mockEntities.clear();
    mockDynamicProperties.clear();
    mockSpawnedItems.length = 0;
    for (const dim of dimensions.values()) {
        dim.blocks.clear();
        dim.particles.length = 0;
        dim.soundsPlayed.length = 0;
    }
    nextRunId = 1;
}

function createEventSignal(registry: Map<string, Function[]>, name: string) {
    return {
        subscribe(callback: Function) {
            const list = registry.get(name) ?? [];
            list.push(callback);
            registry.set(name, list);
            return callback;
        },
        unsubscribe(callback: Function) {
            const list = registry.get(name) ?? [];
            const idx = list.indexOf(callback);
            if (idx >= 0) list.splice(idx, 1);
        }
    };
}

// Beta forbids stacking the custom foods and the bow; cookies cap at 8. Everything else defaults to
// the common 64, matching the item JSON the real engine reads for `maxAmount`.
const MOCK_UNSTACKABLE_IDS = new Set([
    "bh:apple", "bh:bread", "bh:porkchop", "bh:cooked_porkchop",
    "bh:cod", "bh:cooked_cod", "bh:golden_apple", "bh:bow",
    "minecraft:bow", "bh:wooden_door", "bh:iron_door",
    "bh:cake"
]);

export class ItemStack {
    typeId: string;
    amount: number;
    private components = new Map<string, any>();

    constructor(typeId: string, amount: number = 1) {
        this.typeId = typeId;
        this.amount = amount;
    }

    get maxAmount(): number {
        if (this.typeId === "bh:cookie" || this.typeId === "minecraft:cookie") return 8;
        return MOCK_UNSTACKABLE_IDS.has(this.typeId) ? 1 : 64;
    }

    getComponent(componentId: string) {
        return this.components.get(componentId) ?? null;
    }

    setComponent(componentId: string, comp: any) {
        this.components.set(componentId, comp);
    }
}

export class BlockPermutation {
    private static cache = new Map<string, BlockPermutation>();

    readonly typeId: string;
    private states: Record<string, any>;

    get type(): { id: string } {
        return { id: this.typeId };
    }

    private constructor(typeId: string, states: Record<string, any> = {}) {
        this.typeId = typeId;
        this.states = { ...states };
    }

    static resolve(typeId: string, states: Record<string, any> = {}): BlockPermutation {
        const key = `${typeId}:${JSON.stringify(states)}`;
        let perm = BlockPermutation.cache.get(key);
        if (!perm) {
            perm = new BlockPermutation(typeId, states);
            BlockPermutation.cache.set(key, perm);
        }
        return perm;
    }

    getState(key: string): any {
        return this.states[key];
    }

    getAllStates(): Record<string, any> {
        return { ...this.states };
    }

    withState(key: string, value: any): BlockPermutation {
        const next = new BlockPermutation(this.typeId, { ...this.states, [key]: value });
        return next;
    }

    matches(typeId: string): boolean {
        return this.typeId === typeId;
    }
}

export class MolangVariableMap {
    readonly variables = new Map<string, number>();

    setFloat(variableName: string, number: number): void {
        this.variables.set(variableName, number);
    }

    setColorRGB(_variableName: string, _color: any): void {}

    setColorRGBA(_variableName: string, _color: any): void {}

    setSpeedAndDirection(_variableName: string, _speed: number, _direction: any): void {}

    setVector3(_variableName: string, _vector: any): void {}
}

export class BlockVolume {
    readonly from: { x: number; y: number; z: number };
    readonly to: { x: number; y: number; z: number };

    constructor(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }) {
        this.from = from;
        this.to = to;
    }
}

const FACE_OFFSETS: Readonly<Record<string, { x: number; y: number; z: number }>> = Object.freeze({
    Down: { x: 0, y: -1, z: 0 },
    Up: { x: 0, y: 1, z: 0 },
    North: { x: 0, y: 0, z: -1 },
    South: { x: 0, y: 0, z: 1 },
    West: { x: -1, y: 0, z: 0 },
    East: { x: 1, y: 0, z: 0 }
});

export class MockDimension {
    readonly id: string;
    readonly heightRange = { min: -64, max: 319 };
    public blocks = new Map<string, any>();

    constructor(id: string) {
        this.id = id;
    }

    setBlock(location: { x: number; y: number; z: number }, blockData: any) {
        this.blocks.set(`${location.x},${location.y},${location.z}`, blockData);
    }

    setBlockPermutation(location: { x: number; y: number; z: number }, perm: BlockPermutation) {
        const block = this.getBlock(location);
        block.setPermutation(perm);
    }

    setBlockType(location: { x: number; y: number; z: number }, typeId: string) {
        const block = this.getBlock(location);
        block.setType(typeId);
    }

    getBlock(location: { x: number; y: number; z: number }) {
        const key = `${location.x},${location.y},${location.z}`;
        if (this.blocks.has(key)) {
            return this.blocks.get(key);
        }
        const block = {
            typeId: "minecraft:stone",
            permutation: BlockPermutation.resolve("minecraft:stone"),
            location: { ...location },
            dimension: this,
            isSolid: true,
            isLiquid: false,
            isValid: true,
            setType(typeId: string) {
                this.typeId = typeId;
                this.permutation = BlockPermutation.resolve(typeId);
            },
            setPermutation(perm: BlockPermutation) {
                this.permutation = perm;
                this.typeId = perm.type.id;
            },
            canPlace(_blockToPlace: string, faceToPlaceOn?: string) {
                const step = FACE_OFFSETS[faceToPlaceOn ?? ""];
                if (!step) return false;
                const destination = this.dimension.getBlock({
                    x: this.location.x + step.x,
                    y: this.location.y + step.y,
                    z: this.location.z + step.z
                });
                return destination.typeId === "minecraft:air";
            }
        };
        this.blocks.set(key, block);
        return block;
    }

    getEntities(_query?: any) {
        return [...mockEntities.values()].filter((entity) => entity.dimension?.id === this.id);
    }

    getPlayers(query?: { location?: { x: number; y: number; z: number }; maxDistance?: number }) {
        return mockPlayers.filter((player) => {
            if (player.dimension?.id !== this.id) return false;
            if (!query?.location || query.maxDistance === undefined) return true;
            const distance = Math.hypot(
                player.location.x - query.location.x,
                player.location.z - query.location.z
            );
            return distance <= query.maxDistance;
        });
    }

    spawnEntity(typeId: string, location: { x: number; y: number; z: number }) {
        const entity = new Entity();
        entity.id = `mock_entity_${nextRunId++}`;
        entity.typeId = typeId;
        entity.location = { ...location };
        entity.dimension = this;
        mockEntities.set(entity.id, entity);

        for (const callback of registeredAfterEvents.get("entitySpawn") ?? []) {
            callback({ entity });
        }

        return entity;
    }

    spawnItem(itemStack: ItemStack, location: { x: number; y: number; z: number }) {
        const entity = new MockItemEntity(location);
        entity.itemStack = itemStack;
        entity.dimension = this;
        mockSpawnedItems.push(entity);
        return entity;
    }

    particles: { effectName: string; location: any; molang?: any }[] = [];

    spawnParticle(effectName: string, location: { x: number; y: number; z: number }, molangVariables?: any) {
        this.particles.push({ effectName, location, molang: molangVariables });
    }

    soundsPlayed: { soundId: string; location: any; options?: any }[] = [];

    playSound(soundId: string, location: any, options?: any) {
        this.soundsPlayed.push({ soundId, location, options });
    }

    runCommand(_command: string) {
        return { successCount: 1 };
    }
}

const overworldDim = new MockDimension("minecraft:overworld");
const netherDim = new MockDimension("minecraft:the_nether");
const endDim = new MockDimension("minecraft:the_end");

const dimensions = new Map<string, MockDimension>([
    ["overworld", overworldDim],
    ["nether", netherDim],
    ["the_end", endDim],
    ["minecraft:overworld", overworldDim],
    ["minecraft:the_nether", netherDim],
    ["minecraft:the_end", endDim]
]);

export const world = {
    timeOfDay: 0,
    getTimeOfDay() {
        return this.timeOfDay;
    },
    setTimeOfDay(time: number) {
        this.timeOfDay = time;
    },
    getAllPlayers() {
        return [...mockPlayers];
    },
    getPlayers() {
        return [...mockPlayers];
    },
    getEntity(id: string) {
        return mockEntities.get(id);
    },
    getDynamicProperty(identifier: string) {
        return mockDynamicProperties.get(identifier);
    },
    setDynamicProperty(identifier: string, value?: any) {
        if (value === undefined) {
            mockDynamicProperties.delete(identifier);
        } else {
            mockDynamicProperties.set(identifier, value);
        }
    },
    /**
     * The engine's documented default: the Overworld spawn's Y stays unresolved at 32767 until something
     * fixes it, which means "the height is determined by surrounding blocks" — a teleport to that value
     * drops the player above the world. The mock answered a landed 64 for the whole 5.7 cycle, which is
     * what let the respawn's void loop pass offline.
     */
    getDefaultSpawnLocation() {
        return { x: 0, y: 32767, z: 0 };
    },
    /**
     * The `sendcommandfeedback` gamerule, as a player-move helper sees it. Bedrock's own default is on and
     * a world can arrive with it off, so the value is kept rather than assumed: what the helper must not
     * do is write `true` over a world that never had it on.
     */
    gameRules: {
        get sendCommandFeedback(): boolean {
            return mockSendCommandFeedback;
        },
        set sendCommandFeedback(value: boolean) {
            mockSendCommandFeedback = value;
            commandFeedbackWrites.push(value);
        }
    },
    getDimension(dimensionId: string) {
        const dim = dimensions.get(dimensionId);
        if (!dim) {
            const created = new MockDimension(dimensionId);
            dimensions.set(dimensionId, created);
            return created;
        }
        return dim;
    },
    beforeEvents: {
        playerInteractWithBlock: createEventSignal(registeredBeforeEvents, "playerInteractWithBlock"),
        playerInteractWithEntity: createEventSignal(registeredBeforeEvents, "playerInteractWithEntity"),
        playerBreakBlock: createEventSignal(registeredBeforeEvents, "playerBreakBlock"),
        playerPlaceBlock: createEventSignal(registeredBeforeEvents, "playerPlaceBlock"),
        itemUse: createEventSignal(registeredBeforeEvents, "itemUse"),
        entityHurt: createEventSignal(registeredBeforeEvents, "entityHurt"),
        chatSend: createEventSignal(registeredBeforeEvents, "chatSend")
    },
    afterEvents: {
        entitySpawn: createEventSignal(registeredAfterEvents, "entitySpawn"),
        entityLoad: createEventSignal(registeredAfterEvents, "entityLoad"),
        entityDie: createEventSignal(registeredAfterEvents, "entityDie"),
        blockBreak: createEventSignal(registeredAfterEvents, "blockBreak"),
        entityHurt: createEventSignal(registeredAfterEvents, "entityHurt"),
        entityHitEntity: createEventSignal(registeredAfterEvents, "entityHitEntity"),
        entityHitBlock: createEventSignal(registeredAfterEvents, "entityHitBlock"),
        playerSpawn: createEventSignal(registeredAfterEvents, "playerSpawn"),
        playerLeave: createEventSignal(registeredAfterEvents, "playerLeave"),
        playerPlaceBlock: createEventSignal(registeredAfterEvents, "playerPlaceBlock"),
        playerBreakBlock: createEventSignal(registeredAfterEvents, "playerBreakBlock"),
        blockContainerOpened: createEventSignal(registeredAfterEvents, "blockContainerOpened"),
        blockContainerClosed: createEventSignal(registeredAfterEvents, "blockContainerClosed"),
        playerDimensionChange: createEventSignal(registeredAfterEvents, "playerDimensionChange"),
        itemUse: createEventSignal(registeredAfterEvents, "itemUse"),
        itemStartUse: createEventSignal(registeredAfterEvents, "itemStartUse"),
        itemStopUse: createEventSignal(registeredAfterEvents, "itemStopUse"),
        itemReleaseUse: createEventSignal(registeredAfterEvents, "itemReleaseUse"),
        chatSend: createEventSignal(registeredAfterEvents, "chatSend"),
        worldInitialize: createEventSignal(registeredAfterEvents, "worldInitialize"),
        playerGameModeChange: createEventSignal(registeredAfterEvents, "playerGameModeChange"),
        playerInventoryItemChange: createEventSignal(registeredAfterEvents, "playerInventoryItemChange")
    }
};

export const system = {
    currentTick: 0,
    scheduledTimeouts,
    scheduledIntervals,
    activeJobs,
    beforeEvents: {
        startup: createEventSignal(registeredBeforeEvents, "startup")
    },
    afterEvents: {
        scriptEventReceive: createEventSignal(registeredAfterEvents, "scriptEventReceive")
    },
    run(callback: Function): number {
        const id = nextRunId++;
        scheduledTimeouts.push({ id, callback, timeout: 0 });
        return id;
    },
    runInterval(callback: Function, interval: number): number {
        const id = nextRunId++;
        scheduledIntervals.push({ id, callback, interval });
        return id;
    },
    runTimeout(callback: Function, timeout: number): number {
        const id = nextRunId++;
        scheduledTimeouts.push({ id, callback, timeout });
        return id;
    },
    runJob(generator: Generator<void, void, unknown>): number {
        const id = nextRunId++;
        activeJobs.push(generator);
        activeJobEntries.set(id, generator);
        return id;
    },
    clearJob(id: number): void {
        const gen = activeJobEntries.get(id);
        if (gen) {
            activeJobEntries.delete(id);
            const idx = activeJobs.indexOf(gen);
            if (idx >= 0) activeJobs.splice(idx, 1);
        }
    },
    clearRun(id: number): void {
        const intervalIdx = scheduledIntervals.findIndex(i => i.id === id);
        if (intervalIdx >= 0) scheduledIntervals.splice(intervalIdx, 1);
        const timeoutIdx = scheduledTimeouts.findIndex(t => t.id === id);
        if (timeoutIdx >= 0) scheduledTimeouts.splice(timeoutIdx, 1);
    },
    advanceTicks(ticks: number = 1): void {
        for (let t = 0; t < ticks; t++) {
            this.currentTick++;
            for (let i = activeJobs.length - 1; i >= 0; i--) {
                const job = activeJobs[i];
                try {
                    const res = job.next();
                    if (res.done) {
                        activeJobs.splice(i, 1);
                        for (const [id, g] of activeJobEntries) {
                            if (g === job) {
                                activeJobEntries.delete(id);
                                break;
                            }
                        }
                    }
                } catch {
                    activeJobs.splice(i, 1);
                    for (const [id, g] of activeJobEntries) {
                        if (g === job) {
                            activeJobEntries.delete(id);
                            break;
                        }
                    }
                }
            }
        }
    }
};

export const Direction = Object.freeze({
    Down: "Down",
    Up: "Up",
    North: "North",
    South: "South",
    West: "West",
    East: "East"
});

export const EquipmentSlot = Object.freeze({
    Head: "Head",
    Chest: "Chest",
    Legs: "Legs",
    Feet: "Feet",
    Mainhand: "Mainhand",
    Offhand: "Offhand"
});

export const CommandPermissionLevel = Object.freeze({
    Any: 0,
    GameDirectors: 1,
    Admin: 2,
    Host: 3,
    Owner: 4
});

export const CustomCommandStatus = Object.freeze({
    Success: 0,
    Failure: 1
});

export const GameMode = Object.freeze({
    Survival: "survival",
    Creative: "creative",
    Adventure: "adventure",
    Spectator: "spectator"
});

export const InputPermissionCategory = Object.freeze({
    Camera: 1,
    Movement: 2,
    LateralMovement: 4,
    Sneak: 5,
    Jump: 6,
    Mount: 7,
    Dismount: 8,
    MoveForward: 9,
    MoveBackward: 10,
    MoveLeft: 11,
    MoveRight: 12
});

export const HudElement = Object.freeze({
    PaperDoll: 0,
    Armor: 1,
    ToolTips: 2,
    TouchControls: 3,
    Crosshair: 4,
    Hotbar: 5,
    Health: 6,
    ProgressBar: 7,
    Hunger: 8,
    AirBubbles: 9,
    HorseHealth: 10,
    StatusEffects: 11,
    ItemText: 12
});

export const HudVisibility = Object.freeze({
    Hide: 0,
    Reset: 1
});

export const EntityDamageCause = Object.freeze({
    fall: "fall",
    fire: "fire",
    fireTick: "fireTick",
    lava: "lava",
    drowning: "drowning",
    suffocation: "suffocation",
    void: "void",
    starve: "starve",
    magic: "magic",
    wither: "wither",
    flyIntoWall: "flyIntoWall",
    entityAttack: "entityAttack",
    projectile: "projectile",
    entityExplosion: "entityExplosion",
    blockExplosion: "blockExplosion",
    selfDestruct: "selfDestruct",
    suicide: "suicide"
});

export const EntityComponentTypes = Object.freeze({
    Equippable: "minecraft:equippable",
    Inventory: "minecraft:inventory",
    Item: "minecraft:item",
    Health: "minecraft:health",
    Variant: "minecraft:variant",
    Movement: "minecraft:movement",
    Color: "minecraft:color",
    Riding: "minecraft:riding",
    IsHiddenWhenInvisible: "minecraft:is_hidden_when_invisible"
});

export const ItemComponentTypes = Object.freeze({
    Enchantable: "minecraft:enchantable",
    Durability: "minecraft:durability",
    Cooldown: "minecraft:cooldown"
});

export const declaredEntityProperties: Map<string, number> = new Map([
    ["betarock:shadow_span", 1],
    ["betarock:shadow_alpha", 0.5]
]);

export class Entity {
    id: string = "mock_entity";
    typeId: string = "minecraft:item";
    isValid: boolean = true;
    location: any = { x: 0, y: 64, z: 0 };
    dimension: any = dimensions.get("minecraft:overworld");
    protected components = new Map<string, any>();
    isRemoved: boolean = false;
    isOnGround: boolean = true;
    hitboxExtent: { x: number; y: number; z: number } = { x: 0.45, y: 0.45, z: 0.45 };
    private effects = new Map<string, { duration: number; options?: any }>();
    private propertyValues = new Map<string, boolean | number | string>();
    propertyWrites: { identifier: string; value: boolean | number | string }[] = [];

    getProperty(identifier: string): boolean | number | string | undefined {
        return this.propertyValues.get(identifier);
    }

    resetProperty(identifier: string): boolean | number | string {
        const defaultVal = declaredEntityProperties.get(identifier);
        if (defaultVal === undefined) {
            throw new Error(`resetProperty: ${this.typeId} has no property ${identifier}`);
        }
        this.propertyValues.set(identifier, defaultVal);
        this.propertyWrites.push({ identifier, value: defaultVal });
        return defaultVal;
    }

    setProperty(identifier: string, value: boolean | number | string): void {
        if (!declaredEntityProperties.has(identifier)) {
            throw new Error(`setProperty: ${this.typeId} has no property ${identifier}`);
        }
        this.propertyValues.set(identifier, value);
        this.propertyWrites.push({ identifier, value });
    }

    getAABB(): { center: { x: number; y: number; z: number }; extent: { x: number; y: number; z: number } } {
        return { center: { ...this.location }, extent: { ...this.hitboxExtent } };
    }

    getEffect(effectType: string): any {
        const effect = this.effects.get(effectType);
        return effect ? { typeId: effectType, duration: effect.duration, ...effect.options } : undefined;
    }

    addEffect(effectType: string, duration: number, options?: any): void {
        this.effects.set(effectType, { duration, options });
    }

    removeEffect(effectType: string): boolean {
        return this.effects.delete(effectType);
    }

    getComponent(typeId: string): any {
        return this.components.get(typeId);
    }

    hasComponent(typeId: string): boolean {
        return this.components.has(typeId);
    }

    setComponent(typeId: string, component: any): void {
        this.components.set(typeId, component);
    }

    // Entity-scoped, unlike `world`'s. The engine keeps the two stores separate, and the death flag
    // is per-player for exactly that reason.
    private entityDynamicProperties = new Map<string, any>();

    getDynamicProperty(identifier: string) {
        return this.entityDynamicProperties.get(identifier);
    }

    setDynamicProperty(identifier: string, value?: any) {
        if (value === undefined) this.entityDynamicProperties.delete(identifier);
        else this.entityDynamicProperties.set(identifier, value);
    }

    impulse: { x: number; y: number; z: number } | undefined;

    applyImpulse(vector: { x: number; y: number; z: number }): void {
        this.impulse = { ...vector };
    }

    remove(): void {
        this.isValid = false;
        this.isRemoved = true;
    }

    kill(): void {
        this.isValid = false;
        this.isRemoved = true;
    }

    getVelocity(): { x: number; y: number; z: number } {
        return { x: 0, y: 0, z: 0 };
    }

    nameTag: string = "";
    rotation: { x: number; y: number } = { x: 0, y: 0 };
    public animationsPlayed: string[] = [];

    getHeadLocation(): { x: number; y: number; z: number } {
        return { x: this.location.x, y: this.location.y + 1.62, z: this.location.z };
    }

    getViewDirection(): { x: number; y: number; z: number } {
        return { x: 0, y: 0, z: 1 };
    }

    setRotation(rotation: { x: number; y: number }): void {
        this.rotation = { ...rotation };
    }

    teleport(
        location: { x: number; y: number; z: number },
        options?: { rotation?: { x: number; y: number } }
    ): void {
        this.location = { ...location };
        // A teleport carries its rotation with the move, which is the pair the era set in one call.
        if (options?.rotation) this.rotation = { ...options.rotation };
    }

    playAnimation(animationName: string): void {
        this.animationsPlayed.push(animationName);
    }

    // Tags are on `Entity`, not on `Player`: the engine lets any entity wear one, and a destructive
    // gate that recognizes another addon's entity has to ask a mob and an item the same question.
    private tags = new Set<string>();

    addTag(tag: string): boolean {
        this.tags.add(tag);
        return true;
    }

    hasTag(tag: string): boolean {
        return this.tags.has(tag);
    }

    removeTag(tag: string): boolean {
        return this.tags.delete(tag);
    }

    getTags(): string[] {
        return [...this.tags];
    }
}

export class MockItemEntity extends Entity {
    itemStack: ItemStack | undefined;

    constructor(location: { x: number; y: number; z: number }) {
        super();
        this.typeId = "minecraft:item";
        this.location = { ...location };
    }
}

export class Player extends Entity {
    name: string = "Steve";
    public gameMode: string = GameMode.Survival;
    public commandsRun: string[] = [];
    public messagesSent: string[] = [];

    setGameMode(gameMode: string): void {
        this.gameMode = gameMode;
    }

    public readonly inputPermissions = {
        disabled: new Set<number>(),
        setPermissionCategory(category: number, isEnabled: boolean): void {
            if (isEnabled) this.disabled.delete(category);
            else this.disabled.add(category);
        },
        isPermissionCategoryEnabled(category: number): boolean {
            return !this.disabled.has(category);
        }
    };

    public readonly camera = {
        fovWrites: [] as number[],
        clears: 0,
        setFov(options?: { fov?: number }): void {
            this.fovWrites.push(options?.fov ?? -1);
        },
        clear(): void {
            this.clears += 1;
        }
    };

    public spawnPoint: any = undefined;

    getSpawnPoint(): any {
        return this.spawnPoint;
    }

    constructor(id: string = "mock_player", name: string = "Steve") {
        super();
        this.id = id;
        this.name = name;
        this.typeId = "minecraft:player";
    }

    sendMessage(msg: string): void {
        this.messagesSent.push(msg);
    }

    getGameMode(): string {
        return this.gameMode;
    }

    getRotation() {
        return { ...this.rotation };
    }

    public animationsPlayed: { animationName: string; options?: any }[] = [];
    public soundsPlayed: { soundId: string; options?: any }[] = [];

    public onScreenDisplay = {
        titles: [] as string[],
        hiddenHudElements: [] as number[],
        setTitle(text: string) {
            this.titles.push(text);
        },
        setHudVisibility(visibility: number, hudElements?: number[]) {
            if (visibility === HudVisibility.Hide && hudElements) {
                this.hiddenHudElements.push(...hudElements);
            }
        }
    };

    playAnimation(animationName: string, options?: any): void {
        this.animationsPlayed.push({ animationName, options });
    }

    playSound(soundId: string, options?: any): void {
        this.soundsPlayed.push({ soundId, options });
    }

    runCommand(cmd: string) {
        this.commandsRun.push(cmd);
        return { successCount: 1 };
    }
}
export class Container {
    private slots = new Map<number, any>();
    public readonly size: number;

    constructor(size: number = 36) {
        this.size = size;
    }

    getItem(slot: number): any {
        return this.slots.get(slot);
    }

    setItem(slot: number, item?: any): void {
        if (item === undefined || item === null) {
            this.slots.delete(slot);
        } else {
            this.slots.set(slot, item);
        }
    }

    addItem(item: any): any {
        for (let i = 0; i < this.size; i++) {
            if (!this.slots.has(i)) {
                this.slots.set(i, item);
                return undefined;
            }
        }
        return item;
    }
}
export class Block {}
export class Dimension {}
export class Vector3 {}
export class PlayerInteractWithBlockBeforeEvent {}
export class PlayerBreakBlockBeforeEvent {}
export class PlayerPlaceBlockAfterEvent {}
export class ItemComponentUseOnEvent {}
export class EntityHealthComponent {}
export class EntityEquippableComponent {
    private equipment = new Map<string, any>();

    getEquipment(slot: string): any {
        return this.equipment.get(slot);
    }

    setEquipment(slot: string, itemStack?: any): boolean {
        if (itemStack === undefined || itemStack === null) {
            this.equipment.delete(slot);
        } else {
            this.equipment.set(slot, itemStack);
        }
        return true;
    }
}
export class EntityRidingComponent {}
export class ItemUseBeforeEvent {}
export class PlayerGameModeChangeAfterEvent {
    readonly player: any;
    readonly fromGameMode: string;
    readonly toGameMode: string;

    constructor(player: any, fromGameMode: string, toGameMode: string) {
        this.player = player;
        this.fromGameMode = fromGameMode;
        this.toGameMode = toGameMode;
    }
}




