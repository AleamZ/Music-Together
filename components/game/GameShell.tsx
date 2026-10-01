"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { rodLookOf } from "@/lib/game/diorama/character/held";
import { equippedRod } from "@/lib/game/fishing/state";
import { readGfx, subscribeGfx, type GfxMode } from "@/lib/game/diorama/flag";
import { markWorldFailed, unifiedWorldOn } from "@/lib/game/world/flag";
import { worldArrival } from "@/lib/game/world/wild";
import { gateText } from "@/lib/game/world/gates";
import { nearestZone } from "@/lib/game/world/aoi";
import { waypointClick, waypointMarks, type WaypointMark } from "@/lib/game/world/waypoints";
import { isZone, ZONE_IDS, type ZoneId } from "@/lib/game/world/zones";
import WorldMiniMap from "./WorldMiniMap";
import { mapPosToWorld } from "@/lib/game/world/worldmap";
import ZoneToast from "./ZoneToast";
import ChatDrawer from "@/components/room/ChatDrawer";
import MemberList from "@/components/room/MemberList";
import RoomChartModal from "@/components/room/RoomChartModal";
import SettingsDialog from "@/components/room/SettingsDialog";
import { useAnticheat } from "@/hooks/useAnticheat";
import { useCardsController } from "@/hooks/useCardsController";
import { useChat } from "@/hooks/useChat";
import { useDog } from "@/hooks/useDog";
import { useFarmController } from "@/hooks/useFarmController";
import { useFishingController } from "@/hooks/useFishingController";
import { useLooks } from "@/hooks/useLooks";
import { useMyCharacter } from "@/hooks/useMyCharacter";
import { useNews } from "@/hooks/useNews";
import type { PlaybackController } from "@/hooks/usePlayback";
import { useReactions } from "@/hooks/useReactions";
import { useVehicles } from "@/hooks/useVehicles";
import { useVitals } from "@/hooks/useVitals";
import { useHungerNag } from "@/hooks/useHungerNag";
import { heatWhere, useHeat } from "@/hooks/useHeat";
import { HeatActions, HeatChips } from "./HeatHud";
import { useRain } from "@/hooks/useRain";
import { COLD_SPEED, isCold, isRainy, STRIKE_MS } from "@/lib/game/rain/model";
import { UmbrellaContext, UmbrellaModal } from "./rain/UmbrellaShelf";
import { useRoomWeather } from "@/hooks/useRoomWeather";
import { useRoomWeatherSource } from "@/hooks/useRoomWeatherSource";
import type { RoomView } from "@/hooks/useRoom";
import type { UseSponsorBlockResult } from "@/hooks/useSponsorBlock";
import { formatChatMessageBody, parseChatMessageBody } from "@/lib/chat-helpers";
import { formatClock } from "@/lib/format";
import { critterCount } from "@/lib/game/farm/gather";
import { dogHudText, produceSummary } from "@/lib/game/farm/messages";
import { freshAnnouncements } from "@/lib/game/fishing/announce";
import { DEFAULT_LOOK } from "@/lib/game/look";
import { HALL_SPAWN } from "@/lib/game/maps/hall";
import { CITY_PLACES } from "@/lib/game/maps/city";
import { getMap } from "@/lib/game/maps/registry";
import { beatDue, posReport, posReportWorld, type RideReport } from "@/lib/game/position";
import type { Interactable, MapId, Spot } from "@/lib/game/maps/types";
import { overlayLocks } from "@/lib/game/overlays";
import { skipTrip } from "@/lib/game/travel/rpc";
import { CAR_LEFT_TEXT, canRide, dismountText, interactBlocked, mountRefusal, ownedVehicles } from "@/lib/game/travel/ride";
import { isRoadTrip, tripForward, tripVehicle, VEHICLES, WALK_TRIP_MS, type Vehicle, type VehicleId } from "@/lib/game/travel/vehicles";
import { badgesFor, buildRoster, freshChatBubbles, isHereOn, roleAccounts } from "@/lib/game/social";
import type { Look } from "@/lib/game/types";
import { faintCause, isStarving, speedFactor, type FaintCause } from "@/lib/game/vitals";
import { vitalsErrorMessage } from "@/lib/game/vitals-rpc";
import { mapCounts } from "@/lib/presence-modes";
import type { RoomDerived } from "@/lib/room-derived";
import { getCategoryLabel } from "@/lib/sponsorblock";
import AnticheatChip from "./AnticheatChip";
import AnticheatModal from "./AnticheatModal";
import CameraZoomControl from "./CameraZoomControl";
import Camera3dControl from "./Camera3dControl";
import { HudSlotContext } from "./hud/HudSlot";
import StoryLayer from "./story/StoryLayer";                                              // 0114 Chuyện làng
import { useStory } from "@/lib/game/story/useStory";                                     // 0114 Chuyện làng
import { useFold } from "./hud/useFold";
import { HudGroupItems, HudMenu, HudTabs, useHudGroup, type HudGroup } from "./hud/HudMenu";
import { RotateOverlay, TouchControls } from "./hud/TouchHud";
import { ChatFab, MobileDrawer, NoRide, MobileMenuButton, MobileSheet, useCompactHud, type DrawerItem } from "./hud/MobileHud";
import ForestHud from "./forest/ForestHud";
import CityMapModal from "./CityMapModal";
import CardOverlays from "./cards/CardOverlays";
import CardSeatChip from "./cards/CardSeatChip";
import CharacterEditor from "./CharacterEditor";
import DogPanel from "./farm/DogPanel";
import FarmOverlays from "./farm/FarmOverlays";
import MiningOverlays from "./mining/MiningOverlays";
import { useMining } from "@/hooks/useMining";
import FaintOverlay from "./FaintOverlay";
import FightOverlay from "./fight/FightOverlay";
import Dojo from "./fight/Dojo";
import { useDojo } from "@/hooks/useDojo";
import { useRings } from "@/hooks/useRings";
import RingReady from "./fight/RingReady";
import RingBoard from "./fight/RingBoard";
import PvpFight from "./fight/PvpFight";
import { isCalled, useUnderground } from "@/hooks/useUnderground";                 // v20.4
import UndergroundPanel, { type UgTab } from "./fight/UndergroundPanel";
import UgCall from "./fight/UgCall";
import SpectatorView from "./fight/SpectatorView";
import ExamFight from "./fight/ExamFight";
import ResultCard from "./fight/ResultCard";
import { matchTopic } from "@/lib/game/fight/transport";
import { bossOf } from "@/lib/game/fight/underground";
import { MARTIAL, martialById, martialByKey } from "@/lib/game/fight/dojo";
import type { MatchResult } from "@/lib/game/fight/rpc";
import { nameTag } from "@/lib/game/social";
import type { ServerClock } from "@/lib/game/fight/referee";
import { practiceFighter } from "@/lib/game/fight/dojo-gates";
import FashionStoreModal from "./FashionStoreModal";
import RestaurantModal from "./RestaurantModal";
import RideButton from "./RideButton";
import LiftHud from "./LiftHud";
import KeyBadge from "./KeyBadge";
import HotkeysHelp, { HotkeysList } from "./HotkeysHelp";
import { useHotkeys } from "@/hooks/useHotkeys";
import { useLift } from "@/hooks/useLift";
import RoadTripOverlay from "./RoadTripOverlay";
import VehicleShopModal from "./VehicleShopModal";
import PetShopModal from "./PetShopModal";
import PetCenterModal from "./pets/PetCenterModal";                               // v21 pets
import { usePetChallenges } from "./pets/usePetChallenges";                        // v21 pets
import { QuestHudButtons, QuestPanels, type QuestPanel } from "./quests/QuestPanels";
import { usePets } from "@/hooks/usePets";
import MotelModal from "./MotelModal";
import { useMotel } from "@/hooks/useMotel";
import { REST_EFFECT_TEXT, restWalk } from "@/lib/game/housing/motel";
import ApartmentModal from "./housing/ApartmentModal";
import FurnitureShopModal from "./housing/FurnitureShopModal";
import InteriorView from "./housing/InteriorView";
import { useApartment } from "@/hooks/useApartment";
import { aptAdmit, type Layout } from "@/lib/game/housing/apartment";
import { clearDucked, markDucked } from "@/lib/game/housing/duck";
import type { HouseLayout } from "@/lib/game/housing/house";
import { useHouses } from "@/hooks/useHouses";
import HouseBuilder from "./housing/HouseBuilder";
import HouseView from "./housing/HouseView";
import LotModal from "./housing/LotModal";
import EstateModal from "./housing/EstateModal";
import PlayerMarketModal from "./economy/PlayerMarketModal";                                // v21 economy
import StallModal from "./economy/StallModal";                                            // v21 economy
import TradeWindow from "./economy/TradeWindow";                                          // v21 economy
import { TradeDoneFx } from "./celebrate/Fx";                                             // v22 (0086)
import { useTrade } from "@/lib/game/economy/useTrade";                                   // v21 economy
import MailboxModal from "./mail/MailboxModal";                                           // 0111 Hòm thư
import { useMail } from "@/lib/game/mail/useMail";                                        // 0111 Hòm thư
import { petSpeed } from "@/lib/game/pets/model";
import { followingPet, lookOf, myPetCode } from "@/lib/game/pets/rpc";
import SalonModal from "./SalonModal";
import RatChip from "./farm/RatChip";
import { FarmTasksButton } from "./farm/FarmTasks";
import FishingHud, { CoinsChip } from "./fishing/FishingHud";
import FishingOverlays from "./fishing/FishingOverlays";
import ExploreOverlays from "./river/ExploreOverlays";                                          // v22 (0086)
import { useExplore } from "@/hooks/useExplore";                                                 // v22 (0086)
import GameCanvas, { type GameCanvasHandle } from "./GameCanvas";
import HudChatBar from "./HudChatBar";
import HudNowPlaying from "./HudNowPlaying";
import MapCounts from "./MapCounts";
import MiniMap from "./MiniMap";
import WorldHud from "./realm/WorldHud";                                  // v21 world (0075)
import NewsModal from "./NewsModal";
import ChangelogModal from "./news/ChangelogCarousel";
import { useChangelogPopup } from "@/lib/game/news/changelog-seen";
import { ParchmentModal } from "./Parchment";
import QueuePanel from "./QueuePanel";
import SpritePreview from "./SpritePreview";
import VitalsHud, { VitalsNag } from "./VitalsHud";
import StaminaHud from "./professions/StaminaHud";                                  // v21 (0077)
import ProfessionModal from "./professions/ProfessionModal";                        // v21 (0077)
import { useProfessions } from "@/hooks/useProfessions";                            // v21 (0077)
import WeatherChip from "./WeatherChip";
import { PersonalSettingsPanel } from "./PersonalSettings";
import { loadWeatherFx, saveWeatherFx } from "@/lib/game/weather/fx";
import type { WeatherFx } from "@/lib/game/art/weather";
import WeatherLocationDialog from "./WeatherLocationDialog";
import ProfileModal from "./progression/ProfileModal";                        // v21 progression
import { useProgress } from "@/hooks/useProgress";
import { mapMinLevel, mapUnlocked } from "@/lib/game/progression/model";
import { titleText } from "@/lib/game/progression/rpc";

export interface GameShellProps {
  view: RoomView;
  derived: RoomDerived;
  playback: PlaybackController;
  sponsorBlock: UseSponsorBlockResult;
  onExitGame: () => void;
  /** Faint ladder (0045): the 5th faint today — leave game mode until `lockedUntilMs` (VN midnight). */
  onExhausted?: (lockedUntilMs: number) => void;
}

type Panel =
  | "queue" | "board" | "settings" | "members" | "chat" | "wardrobe" | "fashion_store" | "restaurant" | "vehicle_shop" | "salon" | "dog" | "city_map" | "news" | "pet_shop" | "umbrella_stall" | "umbrellas" | "motel" | "apartment" | "furniture_shop" | "lot" | "estate" | "fight_practice" | "dojo" | "ring" | "ring_board" | "underground" | "ug_watch" | "profile" | QuestPanel | "player_market" | "player_stalls" | "professions" | "pet_center" | "mailbox" | null;

/** The toasts the vitals refusals map to (v18.3): seeing one means the bars are stale. */
const VITALS_TEXTS = new Set(["too hungry", "too thirsty", "fainted", "exhausted"].map((m) => vitalsErrorMessage(m)));

/** A portal fades to dark in FADE_MS, the new map starts, and it fades back in after the map's first frame. */
const FADE_MS = 250;

/** v20.4 the hatch's knock (3 long, 2 short) before it opens; none under reduced motion. */
const KNOCK_MS = 1800;

/** v20.4 the server's now, ticking every second while the underground panel or a called match is on screen. */
function useUgNow(clock: ServerClock, on: boolean): number {
  const [nowMs, setNowMs] = useState(() => clock.now(Date.now()));
  useEffect(() => {
    if (!on) return;
    const id = window.setInterval(() => setNowMs(clock.now(Date.now())), 1000);
    return () => window.clearInterval(id);
  }, [clock, on]);
  return nowMs;
}

/** Game mode: the room world (hall, pond and field) and the parchment HUD. Music, queue, chat and roles are the same as the
 *  classic view. */
export default function GameShell({ view, derived, playback, sponsorBlock, onExitGame, onExhausted }: GameShellProps) {
  const { state, role, presence, onlineIds, token, accountId, username, myMemberId, setPresenceMap, setPresenceDog } = view;
  const room = state.room!;
  const { members } = state;
  const { admin_member_id, dj_member_id } = room;
  const canvasRef = useRef<GameCanvasHandle | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [questAt, setQuestAt] = useState<{ x: number; y: number } | null>(null);   // v21: the log opened at bác Ba Làng
  const openQuestPanel = useCallback((p: QuestPanel) => { setQuestAt(null); setPanel(p); }, []);
  const [prompt, setPrompt] = useState<Interactable | null>(null);
  const [connected, setConnected] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [card, setCard] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const close = useCallback(() => setPanel(null), []);
  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  // The game has its own parchment look: portals (RoomChartModal renders into <body>) get the palette too, and the app
  // theme is switched off while the shell is mounted — some theme rules use !important and would restyle the game UI.
  // A layout effect runs before the first paint, so no frame is drawn in the app theme.
  useLayoutEffect(() => {
    const html = document.documentElement;
    const theme = html.getAttribute("data-theme");
    html.removeAttribute("data-theme");
    document.body.classList.add("game-ui");
    return () => {
      document.body.classList.remove("game-ui");
      if (theme !== null && !html.hasAttribute("data-theme")) html.setAttribute("data-theme", theme);
    };
  }, []);

  // --- P2 world mode: the per-browser "3D" graphics AND the server's unified_world flag (else everything is as before);
  //     the engine then runs on one world map while I am on a zone, and walking between zones is not a travel
  const gfx = useSyncExternalStore<GfxMode>(subscribeGfx, readGfx, () => "2d");
  const [serverWorld, setServerWorld] = useState(false);
  const [worldFailed, setWorldFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void unifiedWorldOn().then((on) => { if (live) setServerWorld(on); });
    return () => { live = false; };
  }, []);
  const worldMode = serverWorld && gfx === "3d" && !worldFailed;
  const [zone, setZone] = useState<ZoneId | null>(null);
  const [aoi, setAoi] = useState<ZoneId[]>([]);

  // --- where I am: game mode always starts in the hall; a portal fades out, switches the map, fades back in
  //     `key` counts real arrivals (P2: walking into another zone of the world changes mapId only: `walked`);
  //     `world`: an arrival onto the world that is not a zone's own spot (Mỏ đá's tunnel → the mine mouth)
  const [travel, setTravel] = useState<{ mapId: MapId; arrive: Spot | null; key: number; walked?: boolean; world?: Spot | null }>({ mapId: "hall", arrive: null, key: 0 });
  const [fading, setFading] = useState(false);
  // the HUD's slot for the situational chips (components/game/hud/HudSlot.tsx)
  const [hudSlot, setHudSlot] = useState<HTMLDivElement | null>(null);
  // the HUD menu: grouped entry points (⚙️ 🎒 🧭 📜), every group closed until the player opens one (kept per browser)
  const [hudGroup, setHudGroup] = useHudGroup();
  // phones held sideways: the compact HUD (components/game/hud/MobileHud.tsx) — a ☰ drawer and one sheet at a time
  const compact = useCompactHud();
  const [drawer, setDrawer] = useState(false);
  const [sheet, setSheet] = useState<string | null>(null);
  const closeSheet = useCallback(() => setSheet(null), []);
  const closeDrawer = useCallback(() => setDrawer(false), []);
  // the minimap folds away (kept per browser); open from `sm` up until chosen
  const [miniOpen, setMiniOpen] = useFold("mt.hud.minimap");
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const map = getMap(travel.mapId);
  const inWorld = worldMode && isZone(travel.mapId);
  const presenceAt = inWorld && zone ? zone : travel.mapId;
  // P3: in the wild, the nearest zone goes along for the older clients (they know no "wild"; realtime.ts setMap)
  const [wildNear, setWildNear] = useState<MapId>("hall");
  // P4: my grid cell rides along with the next presence publish (a cell change alone publishes nothing)
  const cellRef = useRef<number | null>(null);
  useEffect(() => {
    setPresenceMap(presenceAt, presenceAt === "wild" ? wildNear : undefined, inWorld ? cellRef.current : null);
  }, [presenceAt, wildNear, inWorld, setPresenceMap]);
  // 0057: where I arrive is a position claim (the server checks each claim against the last one it accepted); P2: walking
  // across the world is not an arrival (the heartbeat below reports it)
  useEffect(() => {
    if (!token || travel.walked) return;
    if (travel.world) { void posReportWorld(token, travel.world.x, travel.world.y); return; }
    const at = travel.arrive ?? getMap(travel.mapId).spawn;
    void posReport(token, travel.mapId, at.x, at.y);
  }, [token, travel]);
  // P2: the position heartbeat while walking the world (pos_report_w, world px) — every 3 s once I moved 16 px.
  // P3 (0089): with what I ride (the server allows 260 × the vehicle's speed_mul px/s), every second while on a vehicle
  // or a lift (a passenger's claim is judged against its driver's latest one).
  const lastBeat = useRef<{ x: number; y: number; at: number } | null>(null);
  const rideReport = useRef<RideReport>(null);
  useEffect(() => {
    if (!token || !inWorld) return;
    lastBeat.current = null;
    const id = window.setInterval(() => {
      const p = canvasRef.current?.worldPos();
      if (!p) return;
      const l = lastBeat.current, now = performance.now();
      if (!beatDue(l, p, now, rideReport.current)) return;
      if (l) void posReportWorld(token, p.x, p.y, rideReport.current);              // the arrival reported the first
      lastBeat.current = { x: p.x, y: p.y, at: now };
    }, 1000);
    return () => window.clearInterval(id);
  }, [token, inWorld]);
  const onZoneChange = useCallback((z: ZoneId) => {
    setZone(z);
    // a zone of the world is the map the HUD, the hooks and the RPCs talk about (the wild keeps the last one)
    if (isZone(z)) setTravel((t) => (t.mapId === z ? t : { ...t, mapId: z, arrive: null, walked: true, world: null }));
  }, []);
  // the 3D world failed to load: fall back to 2D entirely — the per-map game (worldMode off) and the 2D claims
  // (posReport → pos_report); the server still has my tab in world mode, so the fallback itself is claimed in 2D
  const onWorldFailed = useCallback(() => {
    markWorldFailed();
    setWorldFailed(true);
  }, []);
  const onAoiChange = useCallback((zs: ZoneId[], cell?: number) => {
    if (cell !== undefined) cellRef.current = cell;
    setAoi((cur) => (cur.length === zs.length && cur.every((z, i) => z === zs[i]) ? cur : zs));
    const p = canvasRef.current?.worldPos();
    if (p) setWildNear(nearestZone(p));
  }, []);
  // P3: a shut level gate in the world (bamboo barrier + guard)
  const gateLevels = useRef<Readonly<Record<string, number>> | undefined>(undefined);
  const onGate = useCallback((m: MapId) => showToast(gateText(mapMinLevel(m, gateLevels.current))), [showToast]);
  const getWorldPos = useCallback(() => canvasRef.current?.worldPos() ?? null, []);
  // P4 world map: the others in sight and my boat (world mode); a 2D player's spot mapped onto the world (Rừng tràm too)
  const getMapMarks = useCallback(() => canvasRef.current?.mapMarks() ?? { others: [], boat: false }, []);
  const mapIdRef = useRef(travel.mapId);
  useEffect(() => {
    mapIdRef.current = travel.mapId;
  }, [travel.mapId]);
  const getMapPos2d = useCallback(() => {
    const p = canvasRef.current?.localPos();
    return p ? mapPosToWorld(mapIdRef.current, p) : null;
  }, []);
  const openWorldMap = useCallback(() => setPanel("city_map"), []);
  useEffect(() => () => {
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
  }, []);
  // --- riding (v18.7): the vehicle I am on, pushed to the canvas; the ref is for the travel timer
  const [riding, setRiding] = useState<VehicleId | null>(null);
  const [lastRide, setLastRide] = useState<VehicleId | null>(null);
  const ridingRef = useRef<VehicleId | null>(null);
  useEffect(() => {
    ridingRef.current = riding;
    canvasRef.current?.setRiding(riding);
  }, [riding]);
  const leftVehicle = useRef(false);

  const travelRef = useRef(travel);
  const worldModeRef = useRef(worldMode);
  useEffect(() => {
    travelRef.current = travel;
    worldModeRef.current = worldMode;
  }, [travel, worldMode]);
  // the world failed to load (onWorldFailed above): claim where the 2D game puts me, in 2D
  useEffect(() => {
    if (!worldFailed || !token) return;
    const t = travelRef.current;
    const at = t.arrive ?? getMap(t.mapId).spawn;
    void posReport(token, t.mapId, at.x, at.y);
  }, [worldFailed, token]);
  const travelTo = useCallback((to: { map: MapId; arrive: Spot }) => {
    if (fadeTimer.current) return;
    // P2: out of an interior onto the world where its exit is not a zone's spot (Mỏ đá's tunnel → the mine mouth)
    const from = travelRef.current.mapId;
    const world = worldModeRef.current ? worldArrival(from, to.map) : null;
    setFading(true);
    fadeTimer.current = setTimeout(() => {
      fadeTimer.current = null;
      setPrompt(null);
      // arriving where the vehicle cannot go (the car at the pond): I get off
      const v = ridingRef.current;
      if (v && !canRide(to.map, v)) {
        setRiding(null);
        leftVehicle.current = true;
      }
      setTravel((t) => ({ mapId: to.map, arrive: to.arrive, key: t.key + 1, world }));
    }, FADE_MS);
  }, []);
  const onFirstFrame = useCallback(() => {
    setFading(false);
    if (leftVehicle.current) {
      leftVehicle.current = false;
      showToast(CAR_LEFT_TEXT);
    }
  }, [showToast]);

  // --- me
  const { look: savedLook, exists, setSaved } = useMyCharacter(accountId);
  const myLook = savedLook ?? DEFAULT_LOOK;
  const roles = roleAccounts({ admin_member_id, dj_member_id }, members);
  const myBadges = badgesFor(accountId, roles, false);
  const myName = username || members.find((m) => m.account_id === accountId)?.username || "Bạn";
  const creating = savedLook !== null && !exists;

  // --- everyone else on this map (room members only: presence keys and game messages from anyone else are ignored)
  const memberIds = useMemo(() => new Set(members.map((m) => m.account_id)), [members]);
  const { looks, refresh } = useLooks(presence.map((p) => p.accountId).filter((id) => id !== accountId && memberIds.has(id)));
  useEffect(() => {
    canvasRef.current?.setRoster(buildRoster({
      presence, members, room: { admin_member_id, dj_member_id }, localId: accountId, looks,
      mapId: travel.mapId, seating: inWorld ? (aoi.includes("hall") ? getMap("hall").seating : null) : getMap(travel.mapId).seating,
      maps: inWorld ? aoi : undefined,                                            // P2: my zone and its neighbours
    }));
  }, [presence, members, admin_member_id, dj_member_id, accountId, looks, travel, inWorld, aoi]);
  const counts = useMemo(() => mapCounts(presence.filter((p) => memberIds.has(p.accountId))), [presence, memberIds]);

  // --- chat bubbles (this shell owns one useChat; the drawer has its own)
  const { messages, send } = useChat(room.id, token, { accountId, isAdmin: role.isAdmin });
  const shownRef = useRef(new Set<string>());
  useEffect(() => {
    for (const m of freshChatBubbles(messages, shownRef.current, Date.now())) {
      shownRef.current.add(m.id);
      if (m.account_id) canvasRef.current?.showBubble(m.account_id, parseChatMessageBody(m.body).text);
    }
  }, [messages]);

  // --- rare catches and land sales the server announced in the chat (my own catch shows the catch card instead)
  const announcedRef = useRef(new Set<string>());
  useEffect(() => {
    for (const { id, announcement } of freshAnnouncements(messages, announcedRef.current, Date.now())) {
      announcedRef.current.add(id);
      if (announcement.kind !== "catch" || announcement.accountId !== accountId) showToast(announcement.text);
    }
  }, [messages, accountId, showToast]);

  // --- reactions float from the sender's character (from the top of the screen when they are on the other map)
  const { react } = useReactions(room.id, myName, {
    onEvent: (data) => canvasRef.current?.showReaction(data.accountId ?? null, data.emoji),
  });

  // --- hunger and thirst (v18.3): the server-owned bars; a vitals refusal from any game RPC refreshes them
  // v18.10: the heartbeat also says where I stand (the heat)
  const vitalsWhere = useCallback(() => heatWhere(canvasRef.current), []);
  const vitals = useVitals(token, room.id, vitalsWhere);
  const { reload: reloadVitals } = vitals;
  // v20.2 the dojo: fetched when the dojo or the punching bag opens
  const dojo = useDojo(token);
  const { reload: reloadDojo } = dojo;
  const gameToast = useCallback((text: string) => {
    showToast(text);
    if (VITALS_TEXTS.has(text)) void reloadVitals();
  }, [showToast, reloadVitals]);

  // --- fishing: coins, bait, the daily check-in, the song bonus, digging, casting and the fishing panels (bag, depot, shop, records)
  const getCanvas = useCallback(() => canvasRef.current, []);
  const fishing = useFishingController({ token, roomId: room.id, accountId, canvas: getCanvas, current: derived.current, toast: gameToast });
  const { interact: fishingInteract, promptText, cancelCast, onFishingInput } = fishing;
  // v21 progression (0070): my level, title, Fishdex and waypoints; a level-up is toasted and my name tag re-announced
  const progress = useProgress(token, { toast: showToast, onLevelUp: (l) => showToast(`🎉 Lên cấp ${l}! Mở Hồ sơ (⭐) để xem phần thưởng.`) });
  const myLevel = progress.state?.level ?? 1;
  // the zones of the world my level has opened (a locked one is a solid block until P3's barriers)
  const worldLevels = progress.state?.mapLevels;
  // P3: …and Mỏ đá, whose level gate stands before the mine mouth
  const worldZoneKey = [...ZONE_IDS, "mo_da" as const].filter((z) => mapUnlocked(z, myLevel, worldLevels)).join(",");
  useEffect(() => { gateLevels.current = worldLevels ?? undefined; }, [worldLevels]);
  const worldZones = useMemo(() => ({ unlocked: worldZoneKey.split(",").filter(Boolean) as ZoneId[] }), [worldZoneKey]);
  const myTitle = titleText(progress.state);
  // v20.3 Bãi đất trống: the rings (labels, my corner, my live match)
  const rings = useRings({ token, roomId: room.id, accountId, mapId: travel.mapId, canvas: getCanvas, toast: gameToast });
  const { takeCorner } = rings;
  // v20.4 Hầm đấu ngầm: the hatch (hidden until unlocked), the queue, the ladder, the cup, the cage's spectators
  const ug = useUnderground({ token, roomId: room.id, accountId, mapId: travel.mapId, toast: gameToast, onCoins: () => void fishing.data.reload() });
  const { enter: ugEnter } = ug;
  const trade = useTrade(token, room.id, showToast);                                     // v21 economy: the trade window
  const mail = useMail(token);                                                           // 0111: the mailbox and its unread badge
  const refreshMail = mail.refresh;
  const tradeDoneId = trade.state?.lastDone?.id ?? null;
  useEffect(() => { if (tradeDoneId !== null) refreshMail(); }, [tradeDoneId, refreshMail]);   // a finished trade's goods are in the mail
  const [ugTab, setUgTab] = useState<UgTab>("queue");
  const [knocking, setKnocking] = useState<Interactable | null>(null);   // the hatch's knock (3 long, 2 short)
  const [ugResult, setUgResult] = useState<MatchResult | null>(null);
  const ugNowMs = useUgNow(ug.clock, panel === "underground" || isCalled(ug.state));
  const ugHidden = ug.hidden;
  useEffect(() => {
    canvasRef.current?.setHidden(ugHidden);
  }, [ugHidden, travel.mapId]);

  // --- farming: the field of this room, its panels, the due tasks, the plots on the canvas and the work progress
  const farm = useFarmController({
    token, roomId: room.id, accountId, mapId: travel.mapId, canvas: getCanvas, toast: gameToast,
    // the HUD's wallet is the fishing state's: fetch it again when the field moved my coins
    onCoinsChanged: () => void fishing.data.reload(),
  });
  const { interact: farmInteract, promptText: farmPrompt } = farm;
  // --- v21 #19/#26/#89 Mỏ đá: the dig, herbs, chú Tám, the anvil, bà Sáu's cauldron and the potion bag
  const mining = useMining({
    token, roomId: room.id, mapId: travel.mapId, toast: gameToast,
    onCoins: () => void fishing.data.reload(), onVitals: () => void reloadVitals(),
  });
  const { interact: miningInteract, promptText: miningPrompt } = mining;

  // --- my dog (v17 §7.3, §12.3): learned on entering game mode, on the canvas behind me and in presence
  const petDog = useCallback(() => canvasRef.current?.petDog(), []);
  const dog = useDog({
    token, field: farm.data.state, petDog, setPresenceDog, toast: showToast, onCoinsChanged: () => void fishing.data.reload(),
  });
  const dogName = dog.dog?.name ?? null, dogCoat = dog.dog?.coat ?? null, dogHungry = dog.hungry;
  useEffect(() => {
    canvasRef.current?.setLocal({
      name: nameTag(myName, { ...myLook, pgLevel: myLevel, pgTitle: myTitle }), badges: myBadges, look: myLook, dog: dogName !== null && dogCoat !== null ? { name: dogName, coat: dogCoat } : null, dogHungry,
    });
  }, [myName, myBadges, myLook, dogName, dogCoat, dogHungry, myLevel, myTitle]);
  // v21: the others re-read my characters row (pg_level / pg_title) when my level or title changes
  const tagKey = `${myLevel}|${myTitle ?? ""}`;
  const lastTag = useRef<string | null>(null);
  useEffect(() => {
    if (progress.state === null) return;
    if (lastTag.current !== null && lastTag.current !== tagKey) canvasRef.current?.announceLook();
    lastTag.current = tagKey;
  }, [tagKey, progress.state]);
  const { closePanel: closeFarmPanel } = farm;
  const coopDog = { dog: dog.dog, busy: dog.busy, onAdopt: dog.adopt, onOpenDog: () => { closeFarmPanel(); setPanel("dog"); } };

  // --- the card corner: the hall's labels, the table panels, the rules book, and the table I sit at (v16)
  const isMember = useCallback((id: string) => memberIds.has(id), [memberIds]);
  const cards = useCardsController({
    token, roomId: room.id, accountId, mapId: travel.mapId, canvas: getCanvas, toast: gameToast, isMember,
    onCoinsChanged: () => void fishing.data.reload(),
  });
  const { interact: cardsInteract } = cards;

  // --- anti-cheat: the warning or the ban after a strike, and the lock's countdown (anti-cheat spec §12.1)
  const anticheat = useAnticheat();

  // --- the road between the hall and Chợ Lớn (v18.5): a cutscene whose length is the fastest vehicle I own; the portal's
  //     travel happens on arrival (or on a paid skip)
  const vehicles = useVehicles(token);
  // v18.12 Thú cưng: my pets; the one that follows me is on the canvas (and in my movement messages)
  const onPetFound = useCallback((xu: number) => {
    showToast(`🐿️ Sóc lượm được ${xu} xu!`);
    void fishing.data.reload();
  }, [showToast, fishing.data]);
  const pets = usePets(token, room.id, onPetFound);
  const petChallenges = usePetChallenges(token, room.id, useCallback((from: string) => showToast(`⚔️ ${from} thách đấu thú cưng — bấm 🐾 để nhận!`), [showToast]));   // v21 pets
  const { reload: reloadPets } = pets;
  const petCode = myPetCode(pets.state);
  const following = followingPet(pets.state);
  const petSpeedF = petSpeed(following ? lookOf(following) : null);
  // v19.1 Nhà nghỉ: my room and the "Ngủ ngon" buff (walking ×1.07 rides on the pet's walk factor)
  const motel = useMotel(token);
  const { reload: reloadMotel } = motel;
  const walkF = petSpeedF * restWalk(motel.rested);
  // v19.2 Chung cư: the block's list (polled while the lobby is open or I am at home, for the knocks) and the flat I am in
  const [inside, setInside] = useState<Layout | null>(null);
  // v19.3 Khu nhà's lots: the lot panel, the builder and the house I am in
  const [lotNo, setLotNo] = useState<number | null>(null);
  const [building, setBuilding] = useState(false);
  const [insideHouse, setInsideHouse] = useState<HouseLayout | null>(null);
  const apt = useApartment(token, panel === "apartment" || inside?.canEdit === true);
  const { reload: reloadApt } = apt;
  // the TV ducks the room's music on this device while it plays (restored when it stops or I leave)
  const playbackRef = useRef(playback);
  useEffect(() => { playbackRef.current = playback; }, [playback]);
  const duckedFrom = useRef<number | null>(null);
  const duckRoom = useCallback((on: boolean) => {
    const p = playbackRef.current;
    // v19.3: the marker brings the volume back on the next load if the tab closes while ducked
    if (on && duckedFrom.current === null) { duckedFrom.current = p.volume; markDucked(p.volume); p.setVolume(0); }
    else if (!on && duckedFrom.current !== null) { const v = duckedFrom.current; duckedFrom.current = null; p.setVolume(v); clearDucked(); }
  }, []);
  const leaveHome = useCallback((why?: string) => {
    setInside(null);
    setInsideHouse(null);                                               // v19.3
    if (why) showToast(why);
  }, [showToast]);
  useEffect(() => {
    canvasRef.current?.setPet(petCode, walkF);
  }, [petCode, walkF]);
  // v18.11 Báo Làng: the stand's feed, its unread dot and the 24 h dev-blog popup
  const news = useNews(room.id, token);
  const refreshNews = news.refresh;
  const changelog = useChangelogPopup();
  const { reload: reloadVehicles } = vehicles;
  const mapId = travel.mapId;
  // v19.3: the street's houses (polled on Khu nhà, faster while a lot's panel is open), drawn by the engine
  const houses = useHouses(token, panel === "lot" ? 5000 : mapId === "khu_nha" ? 20000 : null);
  const { reload: reloadHouses } = houses;
  const houseLots = houses.state?.lots;
  useEffect(() => {
    canvasRef.current?.setHouses((houseLots ?? []).map((l) => ({ lot: l.no, owned: l.owned, grid: l.grid, roof: l.roof, ownerName: l.ownerName, mine: l.mine })));   // P4: names in 3D
  }, [houseLots]);
  const [trip, setTrip] = useState<{ to: { map: MapId; arrive: Spot }; toMarket: boolean; vehicle: Vehicle | null } | null>(null);
  const skipRoad = useCallback(async (): Promise<boolean> => {
    try {
      await skipTrip(token);
      void fishing.data.reload();
      return true;
    } catch {
      return false;
    }
  }, [token, fishing.data]);

  // --- the faint (v18.3): the server says I fainted, so the cast stops, I wake in the hall and the input is off until revival
  const [faint, setFaint] = useState<{ until: number; serverNow: number; at: number; cause: FaintCause } | null>(null);
  const handledFaint = useRef<number | null>(null);
  const crampSeenAt = useRef(-Infinity);                               // v18.10: when I was last seen cramping (drowning)
  const startFaint = useCallback((until: number, serverNow: number, cause: FaintCause) => {
    handledFaint.current = until;
    setRiding(null);
    // a faint on the road ends the trip first, so the faint's hall travel wins (v18.5)
    setTrip(null);
    setInside(null);                                                    // v19.2: a faint takes me out of the flat too
    setInsideHouse(null);                                               // v19.3: and out of a house
    setFaint({ until, serverNow, at: performance.now(), cause });
    cancelCast();
    travelTo({ map: "hall", arrive: HALL_SPAWN });
  }, [cancelCast, travelTo]);
  // --- weather (v18.8): everyone polls the room's weather; the owner's browser is its source (location stays local)
  const isOwner = myMemberId != null && myMemberId === admin_member_id;
  const roomWeather = useRoomWeather(token, room.id);
  const weatherSource = useRoomWeatherSource({ enabled: isOwner, token, roomId: room.id, onReported: roomWeather.apply });
  const [weatherDialog, setWeatherDialog] = useState(false);
  const weather = roomWeather.weather;
  const rideWeather = roomWeather.effects?.rideSpeed ?? 1;
  useEffect(() => { canvasRef.current?.setWeather(weather); }, [weather]);
  // the viewer's own weather-effects level (display only)
  const [weatherFx, setWeatherFx] = useState<WeatherFx>(loadWeatherFx);
  useEffect(() => { canvasRef.current?.setWeatherFx(weatherFx); }, [weatherFx]);
  const changeWeatherFx = useCallback((l: WeatherFx) => { saveWeatherFx(l); setWeatherFx(l); }, []);
  const vitalsState = vitals.state;
  useEffect(() => {
    const s = vitalsState;
    if (!s || s.faintedUntilMs === null || s.faintedUntilMs <= s.serverNowMs || handledFaint.current === s.faintedUntilMs) return;
    // v18.9: struck by lightning — the bolt plays where I stand first, then the faint takes me to the hall
    const since = s.rain?.struckAtMs != null ? s.serverNowMs - s.rain.struckAtMs : Infinity;
    const until = s.faintedUntilMs;
    const cause = faintCause({
      struckAgoMs: since, crampAgoMs: performance.now() - crampSeenAt.current,
      cold: isCold(s.rain ?? null, s.serverNowMs), wet: s.rain?.wet === true,
    });
    const id = setTimeout(() => startFaint(until, s.serverNowMs, cause), since < STRIKE_MS ? STRIKE_MS - since : 0);
    return () => clearTimeout(id);
  }, [vitalsState, startFaint]);
  // faint ladder (0045): the 5th faint today closes game mode until VN midnight — the classic view, not a crash
  const lockedUntil = vitalsState?.lockedUntilMs ?? null;
  const lockedNow = vitalsState?.serverNowMs ?? 0;
  useEffect(() => {
    if (lockedUntil === null || lockedUntil <= lockedNow) return;
    // the server's clock → mine, for the countdown on the classic view
    const until = Date.now() + (lockedUntil - lockedNow);
    if (onExhausted) onExhausted(until);
    else onExitGame();
  }, [lockedUntil, lockedNow, onExhausted, onExitGame]);
  // 3D wave 1: my rod, reel and bobber on the 3D rod — 0115: the equipped rod instance's own parts (else the loadout)
  const fishState = fishing.data.state;
  const rodLook = useMemo(() => {
    const eq = fishState ? equippedRod(fishState) : null;
    const lo = fishState?.loadout ?? null;
    return eq ? rodLookOf(eq) : lo ? { rod: lo.rod, reel: lo.reel ?? null, bobber: lo.bobber } : null;
  }, [fishState]);
  useEffect(() => {
    canvasRef.current?.setRodLook?.(rodLook);
  }, [rodLook]);
  const endFaint = useCallback(() => {
    setFaint(null);
    void reloadVitals();
  }, [reloadVitals]);
  // --- heat shock and swimming (v18.10): the chips, the pond-edge actions, the cramp and the rescue
  const heat = useHeat({ token, roomId: room.id, canvasRef, fromVitals: vitalsState?.heat, reloadVitals, showToast });
  useEffect(() => {
    if (heat.probe?.cramping || vitalsState?.heat?.crampUntilMs != null) crampSeenAt.current = performance.now();
  }, [heat.probe, vitalsState]);
  // --- rain (v18.9): umbrellas, wet, cảm lạnh and lightning
  const reloadCoins = useCallback(() => void fishing.data.reload(), [fishing.data]);
  const story = useStory(token, { toast: showToast, onCoins: reloadCoins });              // 0114: the story chain
  const storyTalk = story.talk;
  // v22 (0086): chèo ghe to Sông Cái and back, the treasure detector and dig
  const explore = useExplore({
    token, roomId: room.id, mapId: travel.mapId, canvas: getCanvas, toast: gameToast, travelTo, cancelCast: fishing.cancelCast,
    onCoins: reloadCoins, onMaps: fishing.extras.reload,
  });
  const exploreHome = explore.rowHome;
  const profs = useProfessions(token, canvasRef);                                     // v21 (0077): stamina, nghề
  const rain = useRain({ token, canvasRef, fromVitals: vitalsState?.rain, raining: isRainy(weather?.kind), onCoinsChanged: reloadCoins, showToast });
  const rainCold = rain.cold;
  const starving = vitalsState ? isStarving(vitalsState) : false;
  // 3D wave 1: my vital state on the 3D chibi — lying fainted while the faint screen is up, slumped while starving
  useEffect(() => { canvasRef.current?.setVital?.(faint ? "faint" : starving ? "exhausted" : null); }, [faint, starving]);
  useEffect(() => {
    // riding is slowed by the room's weather (v18.8 effects.rideSpeed); v18.9: cảm lạnh halves every speed
    canvasRef.current?.setSpeedFactor((vitalsState ? speedFactor(vitalsState) : 1) * (riding ? rideWeather : 1) * (rainCold ? COLD_SPEED : 1));
  }, [vitalsState, riding, rideWeather, rainCold]);
  const dismount = useCallback(() => setRiding(null), []);
  // becoming starving takes me off the vehicle (adjusted during render, not in an effect)
  const [wasStarving, setWasStarving] = useState(starving);
  if (starving !== wasStarving) {
    setWasStarving(starving);
    if (starving) setRiding(null);
  }

  // mounting: refused while busy (fishing, farm work, a card seat, the road, a faint), with the car at the pond, or starving
  const rideBusy = fishing.cast.phase !== "idle" || farm.work !== null || farm.round !== null || farm.crab !== null
    || farm.sling !== null || cards.seated !== null || trip !== null || faint !== null;
  const mount = useCallback((v: VehicleId) => {
    const why = mountRefusal({ map: mapId, v, starving, busy: rideBusy });
    if (why !== null) {
      if (why) showToast(why);
      return;
    }
    setRiding(v);
    setLastRide(v);
  }, [mapId, starving, rideBusy, showToast]);

  // --- input is off while any panel, the farm work, the create editor or an anti-cheat modal is open; an Esc belongs to
  //     an open overlay outside the field's own, not to the farm work
  const [helpOpen, setHelpOpen] = useState(false); // the "⌨️ Phím tắt" overlay (H / ?)
  const [worldOpen, setWorldOpen] = useState(false); // v21 world (0075): the 🌍 panel
  const [forestOpen, setForestOpen] = useState(false); // 0096: chopping, cooking, the stall's logs
  const openOverlays = {
    panel: panel !== null || inside !== null || insideHouse !== null || building || helpOpen || rings.active !== null
      || ug.active !== null || ugResult !== null || knocking !== null || isCalled(ug.state)                     // v20.4
      || worldOpen                                                                                             // v21 world
      || forestOpen                                                                                            // 0096 forest
      || trade.state?.trade != null                                                                             // v21 economy
      || mining.open                                                                                            // v21 Mỏ đá
      || explore.open,                                                                                          // v22 (0086)
    fishingPanel: fishing.panel !== null || fishing.net !== null, creating, anticheatModal: anticheat.modal !== null,
    farmPanel: farm.panel !== null, farmWork: farm.work !== null, farmRound: farm.round !== null, farmCrab: farm.crab !== null,
    slingGame: farm.sling !== null,
    cardPanel: cards.panel !== null, rulesBook: cards.rules !== null, dogPanel: panel === "dog",
    fainted: faint !== null, trip: trip !== null,
  };
  // v18.11: a fresh dev-blog post pops up only while nothing else holds the screen (a faint, the road, any panel), and
  // then holds the input like a panel until it is closed
  const newsPopupOpen = !overlayLocks(openOverlays).blocking && news.popup.length > 0;
  // the 25–28/9 bulletin pops up once per browser, after any dev-blog popup
  const changelogOpen = !overlayLocks(openOverlays).blocking && !newsPopupOpen && changelog.due;
  const { blocking, panelOpen } = overlayLocks({ ...openOverlays, panel: openOverlays.panel || newsPopupOpen || changelogOpen });
  const newsUnread = news.unread;
  useEffect(() => {
    canvasRef.current?.setNewsUnread(newsUnread);
  }, [newsUnread, mapId]);
  useEffect(() => {
    canvasRef.current?.setInputEnabled(!blocking);
  }, [blocking]);
  // 0047: a low bar nags me (a local bubble over my head only — not chat, not broadcast) while nothing holds the screen
  const sayToSelf = useCallback((text: string) => canvasRef.current?.showBubble(accountId, text), [accountId]);
  useHungerNag(vitalsState, blocking, sayToSelf);

  // --- the camera may lift the character above the bottom HUD
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = bottomRef.current;
    if (!el) return;
    const apply = () => canvasRef.current?.setBottomInset(Math.ceil(el.getBoundingClientRect().height) + 8);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // --- đi nhờ xe (v18.13): asking a rider for a lift, carrying one passenger, following my driver through portals
  const nameOf = useCallback((id: string) => members.find((m) => m.account_id === id)?.username ?? "Ai đó", [members]);
  const followDriver = useCallback((m: MapId, v: VehicleId): boolean => {
    const door = getMap(mapId).interactables.find((i) => i.kind === "portal" && i.to?.map === m);
    if (!door?.to) return false;
    cancelCast();
    // P3 world mode: no road-trip hops — the engine keeps me on my driver's vehicle along the world's roads
    if (inWorld && isRoadTrip(mapId, m)) return true;
    if (isRoadTrip(mapId, m)) setTrip({ to: door.to, toMarket: tripForward(mapId, m), vehicle: VEHICLES.find((x) => x.id === v) ?? null });
    else travelTo(door.to);
    return true;
  }, [mapId, cancelCast, travelTo, inWorld]);
  const lift = useLift({
    canvasRef, riding, fainted: faint !== null, nameOf, toast: showToast, follow: followDriver,
    canAsk: riding === null && !rideBusy && !blocking,
    canCarry: riding !== null && trip === null && faint === null,
    inTransit: () => trip !== null || fadeTimer.current !== null,
  });
  const { portal: liftPortal } = lift;
  const liftKind = lift.state.kind;
  useEffect(() => {
    rideReport.current = liftKind === "passenger" ? "lift" : riding;                  // P3: the heartbeat's ride
  }, [liftKind, riding]);
  // the HUD hotkeys (lib/game/hotkeys.ts): one listener; a key clicks its visible button
  useHotkeys({ enabled: !blocking && faint === null && trip === null, helpOpen, offer: lift.offer !== null }, () => setHelpOpen((o) => !o));
  const liftTrip = lift.state.kind === "passenger"
    ? { look: looks.get(lift.state.driver) ?? DEFAULT_LOOK, pillion: myLook, canSkip: false }
    : { look: myLook, pillion: lift.state.kind === "driver" ? looks.get(lift.state.passenger) ?? DEFAULT_LOOK : null, canSkip: true };
  // on someone's vehicle I cannot get on my own
  const liftAboard = lift.aboard;
  const mountOwn = useCallback((v: VehicleId) => {
    if (liftAboard) showToast("Đang đi nhờ xe — xuống xe trước đã!");
    else mount(v);
  }, [liftAboard, mount, showToast]);

  // v21 #93: a waypoint fast travel — the server checks where I stand, charges, and moves its position; then I arrive
  const progressTravel = progress.travel;
  const teleport = useCallback(async (id: string) => {
    const r = await progressTravel(id);
    if (!r) return;
    setPanel(null);
    cancelCast();
    travelTo({ map: r.to.map, arrive: { x: r.to.x, y: r.to.y, dir: r.to.dir } });
    reloadCoins();
  }, [progressTravel, cancelCast, travelTo, reloadCoins]);
  // P3 world mode: the waypoints on the world map and the minimap; a click on a discovered one is that trip
  const wpState = progress.state?.waypoints, wpAt = progress.state?.atWaypoint ?? null;
  const wpMarks = useMemo(() => waypointMarks(new Set((wpState ?? []).filter((w) => w.found).map((w) => w.id)), wpAt), [wpState, wpAt]);
  const onWaypoint = useCallback((m: WaypointMark) => {
    const c = waypointClick(m);
    if (!c.travel) showToast(c.why);
    else void teleport(m.id);
  }, [showToast, teleport]);

  const onInteract = useCallback((it: Interactable) => {
    if (interactBlocked(riding, it.kind)) {
      showToast(dismountText(it.prompt));
      return;
    }
    if (storyTalk(it)) return;                                              // 0114: an NPC of the story speaks first
    switch (it.kind) {
      case "dj_booth":
        setPanel("queue");
        break;
      case "notice_board":
        setPanel("board");
        break;
      case "portal":
        if (!it.to) break;
        if (!mapUnlocked(it.to.map, myLevel, progress.state?.mapLevels)) {                    // v21 #92: the map's level
          showToast(`🔒 Cần đạt cấp ${mapMinLevel(it.to.map, progress.state?.mapLevels)} mới vào được khu này.`);
          break;
        }
        cancelCast();
        liftPortal(it.to.map);                                              // v18.13: my passenger comes along
        if (!inWorld && isRoadTrip(mapId, it.to.map)) {                     // P3: no road-trip hops in the world
          // the road is driven on the vehicle I am riding, else the fastest I own (v18.7)
          setTrip({
            to: it.to, toMarket: tripForward(mapId, it.to.map),
            vehicle: riding ? VEHICLES.find((x) => x.id === riding) ?? null : tripVehicle(vehicles.owned),
          });
          break;
        }
        travelTo(it.to);
        break;
      case "restaurant":
        setPanel("restaurant");
        break;
      case "vehicle_shop":
        setPanel("vehicle_shop");
        void reloadVehicles();
        break;
      case "clothes_shop":
        setPanel("fashion_store");
        break;
      case "salon":
        setPanel("salon");
        break;
      case "city_map":
        setPanel("city_map");
        break;
      case "river_dock":                                                   // v22 (0086): row back to the pond
        exploreHome();
        break;
      case "pet_shop":
        setPanel("pet_shop");
        void reloadPets();
        break;
      case "news_stand":
        setPanel("news");
        refreshNews();
        break;
      case "umbrella_stall":
        setPanel("umbrella_stall");
        break;
      case "motel":
        setPanel("motel");
        void reloadMotel();
        break;
      case "apartment":                                                     // v19.2
        setPanel("apartment");
        void reloadApt();
        break;
      case "furniture_shop":                                                // v19.2
        setPanel("furniture_shop");
        void reloadApt();
        break;
      case "lot":                                                           // v19.3
        setLotNo(it.lot ?? null);
        setBuilding(false);
        setPanel("lot");
        void reloadHouses();
        break;
      case "estate":                                                        // v19.4
        setPanel("estate");
        break;
      case "player_stalls":                                                 // v21 economy: chú Bảy's rented stalls
        setPanel("player_stalls");
        break;
      case "punch_bag":                                                     // v20.1
        setPanel("fight_practice");
        void reloadDojo();
        break;
      case "dojo":                                                          // v20.2
        setPanel("dojo");
        void reloadDojo();
        break;
      case "ring_corner":                                                   // v20.3: take the corner, the ready screen
        setPanel("ring");
        void takeCorner(it.ring ?? 1, it.corner ?? "red");
        break;
      case "ring_board":                                                    // v20.3
        setPanel("ring_board");
        break;
      case "ug_hatch":                                                      // v20.4: knock 3 long 2 short, then down
        if (!it.to) break;
        cancelCast();
        setKnocking(it);
        break;
      case "ug_organizer":                                                  // v20.4: anh Tư Sẹo
        setUgTab("queue");
        setPanel("underground");
        break;
      case "ug_board":                                                      // v20.4
        setUgTab("board");
        setPanel("underground");
        break;
      case "ug_door":                                                       // v20.4: the ladder's door
        setUgTab("ladder");
        setPanel("underground");
        break;
      case "quest_giver":                                                  // v21: bác Ba Làng
        setQuestAt({ x: it.use.x, y: it.use.y });
        setPanel("quests");
        break;
      case "cage_watch":                                                    // v20.4: watch the live match
        setPanel("ug_watch");
        break;
      default:
        if (!farmInteract(it) && !miningInteract(it) && !cardsInteract(it) && !fishingInteract(it)) showToast("Sắp mở — chờ chút nhé!");
    }
  }, [travelTo, showToast, fishingInteract, farmInteract, miningInteract, cardsInteract, cancelCast, mapId, reloadVehicles, riding, vehicles.owned, refreshNews, reloadPets, liftPortal, reloadMotel, reloadApt, reloadHouses, reloadDojo, takeCorner, myLevel, progress.state?.mapLevels, exploreHome, inWorld, storyTalk]);

  // v20.4 the knock on the hatch: ug_enter checks the unlock again, then down the ladder (the refs keep a re-render
  // from cancelling the knock)
  const knockRef = useRef({ enter: ugEnter, travelTo });
  useEffect(() => {
    knockRef.current = { enter: ugEnter, travelTo };
  }, [ugEnter, travelTo]);
  useEffect(() => {
    if (!knocking?.to) return;
    const to = knocking.to;
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const id = window.setTimeout(() => {
      void knockRef.current.enter().then((ok) => {
        setKnocking(null);
        if (ok) knockRef.current.travelTo(to);
      });
    }, reduced ? 0 : KNOCK_MS);
    return () => window.clearTimeout(id);
  }, [knocking]);

  const leaveBroken = useCallback((message: string) => {
    window.alert(message);
    onExitGame();
  }, [onExitGame]);
  const onUnsupported = useCallback(() => leaveBroken("Trình duyệt này không vẽ được thế giới game — quay về giao diện cũ."), [leaveBroken]);
  const onFatal = useCallback(() => leaveBroken("Thế giới game gặp lỗi — quay về giao diện cũ."), [leaveBroken]);

  const onSaved = useCallback((look: Look) => {
    setSaved(look);
    setPanel(null);
    canvasRef.current?.announceLook();
  }, [setSaved]);

  const djName = members.find((m) => m.account_id === derived.djAccountId)?.username ?? null;
  const skipped = sponsorBlock.lastSkippedToast;
  const cardMember = card ? members.find((m) => m.account_id === card) : undefined;
  const cardPresence = card ? presence.find((p) => p.accountId === card) : undefined;
  const cardWhere = cardPresence?.mode === "classic" ? "🖥️ Đang ở giao diện cũ"
    : cardPresence?.map === "pond" ? "🎣 Đang ở ao câu cá"
    : cardPresence?.map === "field" ? "🌾 Đang ở đồng ruộng"
    : cardPresence?.map === "market" || cardPresence?.map === "ham_ngam" ? "🏮 Đang đi Chợ Lớn"   // v20.4: the hầm stays a secret
    : cardPresence?.map === "khu_nha" ? "🏘️ Đang ở Khu nhà"
    : cardPresence?.map === "bai_dat" ? "🥊 Đang ở Bãi đất trống"
    : cardPresence?.map === "wild" ? "🌲 Đang dạo ngoài đồng" : "🎮 Đang dạo quanh sảnh";

  const mailUnread = mail.box?.unread ?? 0;
  const hudGroups: HudGroup[] = [
    {
      id: "settings", icon: "⚙️", label: "Cài đặt", hotkey: "settings", hotkeyBadge: <KeyBadge id="settings" />,
      content: (
        <HudTabs tabs={[
          { id: "general", label: "Chung", content: <PersonalSettingsPanel weatherFx={weatherFx} onWeatherFx={changeWeatherFx} /> },
          {
            id: "camera", label: "Camera & zoom", reveal: true,
            content: (
              <div className="flex flex-col gap-1 font-vt text-base">
                {worldMode ? <Camera3dControl /> : (
                  <CameraZoomControl mapWidth={map.width} mapHeight={map.height} onZoomChange={(z) => canvasRef.current?.setZoom(z)} />
                )}
                <p className="text-sm opacity-75">Lăn chuột hoặc chụm hai ngón trên màn hình để zoom nhanh.</p>
              </div>
            ),
          },
          {
            id: "hotkeys", label: "Phím tắt",
            content: (
              <div className="flex flex-col gap-1.5">
                <HotkeysList />
                <button type="button" className="pch-btn relative self-start font-vt text-base pointer-coarse:hidden" onClick={() => setHelpOpen(true)}>
                  ⌨️ Mở bảng lớn<KeyBadge id="help" />
                </button>
              </div>
            ),
          },
          {
            id: "map", label: "Bản đồ",
            content: (
              <div className="flex flex-wrap gap-1 font-vt text-base">
                <button type="button" className="pch-btn min-h-10 px-2" onClick={openWorldMap}>🗺️ Mở bản đồ thế giới</button>
                <button type="button" className="pch-btn min-h-10 px-2" data-testid="minimap-toggle" aria-pressed={miniOpen !== false}
                  onClick={() => setMiniOpen(miniOpen === false)}>
                  {miniOpen === false ? "🧭 Hiện bản đồ nhỏ" : "🧭 Ẩn bản đồ nhỏ"}
                </button>
              </div>
            ),
          },
        ]} />
      ),
    },
    {
      id: "bag", icon: "🎒", label: "Túi đồ", badge: mailUnread,
      content: (
        <HudGroupItems>
          <button type="button" className="pch-btn relative" data-hotkey="bag" title="Giỏ đồ (B)" onClick={() => fishing.openPanel("bag")}>
            🧺<span className="sr-only"> Giỏ đồ</span><KeyBadge id="bag" />
          </button>
          <button type="button" className="pch-btn relative" data-hotkey="wardrobe" title="Tủ đồ (I)" onClick={() => setPanel("wardrobe")} disabled={savedLook === null}>
            👕<span className="sr-only"> Tủ đồ</span><KeyBadge id="wardrobe" />
          </button>
          <button type="button" className="pch-btn relative" data-testid="mailbox-hud" onClick={() => setPanel("mailbox")}
            title={mailUnread > 0 ? `Hòm thư: ${mailUnread} thư chưa đọc` : "Hòm thư · nhập code quà"}>
            📬<span className="sr-only"> Hòm thư</span>
            {mailUnread > 0 && (
              <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-red-600 px-0.5 text-center font-sans text-[10px] leading-4 text-white"
                data-testid="mailbox-unread">{Math.min(99, mailUnread)}</span>
            )}
          </button>
          {fishing.handFish !== null && (
            <button
              type="button" className="pch-btn relative" data-hotkey="fish" aria-pressed={!fishing.fishStowed}
              title={fishing.fishStowed ? "Lấy cá ra cầm trên tay (F)" : "Cất cá vào giỏ (F)"} onClick={fishing.toggleFishStowed}
            >
              🐟<span className="sr-only">{fishing.fishStowed ? " Lấy cá ra" : " Cất cá"}</span><KeyBadge id="fish" />
            </button>
          )}
          {(rain.state?.umbrellas.length ?? 0) > 0 && (
            <button type="button" className="pch-btn relative" data-hotkey="umbrellas" title="Ô của tôi (cầm tay) (U)" onClick={() => setPanel("umbrellas")}>
              ☂️<span className="sr-only"> Ô của tôi</span><KeyBadge id="umbrellas" />
            </button>
          )}
        </HudGroupItems>
      ),
    },
    {
      id: "play", icon: "🧭", label: "Hoạt động", badge: petChallenges > 0 || (map.id === "field" && farm.urgent > 0),
      content: (
        <HudGroupItems>
          <button type="button" className="pch-btn relative" title="Chợ người chơi · đấu giá (4)" data-testid="player-market-hud" data-hotkey="playerMarket" onClick={() => setPanel("player_market")}>
            🏪<span className="sr-only"> Chợ người chơi</span><KeyBadge id="playerMarket" />
          </button>
          <button type="button" className="pch-btn relative" title="Trại thú: trứng, nuôi dạy, đấu thú, cá chiến (5)" data-testid="pet-center-hud"
            data-hotkey="petCenter" onClick={() => { setPanel("pet_center"); void reloadPets(); }}>
            🐾<span className="sr-only"> Trại thú</span><KeyBadge id="petCenter" />
            {petChallenges > 0 && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-600" aria-hidden="true" />}
          </button>
          {dog.dog && (
            <button type="button" className="pch-btn relative truncate" data-hotkey="dog" title={`Chó của bạn: ${dog.dog.name}${dog.hungry ? " (đang đói)" : ""} (P)`}
              onClick={() => setPanel("dog")}>{dogHudText(dog.dog.name, dog.hungry)}</button>
          )}
          {map.id === "field" && <FarmTasksButton urgent={farm.urgent} onClick={() => farm.openPanel({ kind: "tasks" })} />}
        </HudGroupItems>
      ),
    },
    {
      id: "quests", icon: "📜", label: "Nhiệm vụ & tin tức", badge: news.unread,
      content: (
        <HudGroupItems>
          <QuestHudButtons token={token} canPopup={!blocking} onOpen={openQuestPanel} />
          {news.unread && (
            <span className="pch-btn relative cursor-default" title="Báo Làng có tin mới — ghé sạp báo ở sảnh" data-testid="news-hud">
              📰<span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-600" aria-hidden="true" />
              <span className="sr-only"> Báo Làng có tin mới</span>
            </span>
          )}
        </HudGroupItems>
      ),
    },
  ];

  // the HUD's parts, placed in the top bar on a computer or in the ☰ sheets on a phone
  const statusCard = (
          <div className="pch pointer-events-auto flex flex-col gap-1.5 p-1.5 font-vt leading-none" data-testid="player-hud">
            <div className="flex items-center gap-2">
              <SpritePreview look={myLook} scale={2} className="shrink-0 rounded-sm bg-parchment" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-xl" title={`${myBadges ? `${myBadges} ` : ""}${myName}`}>
                    {myBadges ? `${myBadges} ` : ""}{myName}
                  </span>
                  <button type="button" className="pch-btn relative shrink-0 px-1.5 py-0.5 text-base tabular-nums" title="Hồ sơ: cấp độ, thành tựu, danh hiệu, Fishdex, xếp hạng (1)" data-testid="profile-hud"
                    data-hotkey="profile" onClick={() => { setPanel("profile"); void progress.reload(); }}>
                    ⭐ {myLevel}<span className="sr-only"> Hồ sơ, cấp {myLevel}</span><KeyBadge id="profile" />
                  </button>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-base">
                  <CoinsChip state={fishing.data.state} />
                  <WeatherChip
                    weather={weather}
                    tempC={weatherSource.tempC}
                    isOwner={isOwner}
                    needsLocation={weatherSource.status === "needed"}
                    onOpenLocation={() => setWeatherDialog(true)}
                  />
                </div>
              </div>
            </div>
            {!connected && <span className="text-sm opacity-80">Đang kết nối thế giới…</span>}
            {/* the body: hunger, thirst and stamina; then the passing states and the fishing / farm line */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t-2 border-parchment-300 pt-1.5 text-sm">
              <VitalsHud state={vitals.state} nag={false} />
              <StaminaHud stamina={profs.stamina} value={profs.staminaValue} state={profs.state} nowMs={profs.nowMs}
                onOpen={() => setPanel("professions")} />{/* v21 (0077) */}
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm empty:hidden">
              <VitalsNag state={vitals.state} />
              <HeatChips chips={heat.chips} />
              {motel.rested && <span data-testid="rest-chip" title={`Ngủ ngon: ${REST_EFFECT_TEXT}`} className="whitespace-nowrap">😴 Ngủ ngon</span>}
              {rain.chips.map((c) => (
                <span key={c.key} data-testid={`rain-${c.key}`} title={c.title}
                  className={`whitespace-nowrap tabular-nums ${c.key === "cold" ? "text-sky-800" : ""}`}>{c.text}</span>
              ))}
              <FishingHud
                state={fishing.data.state}
                failed={fishing.data.failed}
                onReload={() => void fishing.data.reload()}
                riceLine={map.id === "field" && farm.data.state
                  ? produceSummary(farm.data.state.mine.rice, farm.data.state.mine.produce, critterCount(farm.data.state.mine.critters))
                  : null}
              />
            </div>
          </div>
  );
  const rideBox = (
            <div className="pch pointer-events-auto p-1 font-vt text-lg leading-none empty:hidden [&_.pch-btn]:inline-flex [&_.pch-btn]:h-9 [&_.pch-btn]:min-w-9 [&_.pch-btn]:items-center [&_.pch-btn]:justify-center [&_.pch-btn]:pointer-coarse:h-11 [&_.pch-btn]:pointer-coarse:min-w-11">
              <RideButton
                owned={vehicles.owned}
                riding={riding}
                last={lastRide}
                keyEnabled={!blocking}
                onMount={(v) => { mountOwn(v); setSheet(null); }}
                onDismount={() => { dismount(); setSheet(null); }}
              />
            </div>
  );
  const hudSlotBox = (
          <div ref={setHudSlot} className="pointer-events-auto flex flex-col items-start gap-1.5 empty:hidden" data-testid="hud-slot">
            <AnticheatChip secondsLeft={anticheat.secondsLeft} />
            {cards.seated && <CardSeatChip table={cards.seatTable} me={accountId} onOpen={() => cards.seated && cards.openPanel(cards.seated)} />}
          </div>
  );
  const countsBox = (
        <div className="flex flex-col items-center gap-1">
          <MapCounts counts={counts} world={inWorld} />
          {map.id === "field" && (
            <RatChip live={farm.data.state?.rats?.live.length ?? 0} onOpen={() => farm.openPanel({ kind: "handbook", tab: "rats" })} />
          )}
        </div>
  );
  const nowPlaying = (
        <HudNowPlaying
          room={room}
          current={derived.current}
          djName={djName}
          canControl={role.canControlPlayback}
          playback={playback}
          canOpenSettings={role.isAdmin || role.isDj}
          onOpenQueue={() => setPanel("queue")}
          onOpenBoard={() => setPanel("board")}
          onOpenSettings={() => setPanel("settings")}
        />
  );
  const chatBar = (
        <HudChatBar
          onSend={(text) => send(formatChatMessageBody(text))}
          onReact={react}
          onOpenChat={() => setPanel("chat")}
          onOpenMembers={() => setPanel("members")}
          onlineCount={onlineIds.length}
          onExitGame={onExitGame}
        />
  );
  const drawerItems: DrawerItem[] = [
    { id: "status", icon: "🧑", label: "Trạng thái" },
    ...hudGroups.map((g) => ({ id: g.id, icon: g.icon, label: g.label, badge: g.badge })),
    { id: "map", icon: "🗺️", label: "Bản đồ", onPick: openWorldMap },
    { id: "ride", icon: "🚗", label: "Phương tiện" },
    { id: "chat", icon: "💬", label: "Chat" },
    { id: "members", icon: "👥", label: `Thành viên (${onlineIds.length})`, onPick: () => setPanel("members") },
    { id: "classic", icon: "🖥️", label: "Giao diện cũ", onPick: onExitGame },
  ];

  return (
    <HudSlotContext.Provider value={hudSlot}>
    <UmbrellaContext.Provider value={{ rain, coins: fishing.data.state?.coins ?? null }}>
    <div className={`game-ui fixed inset-0 overflow-hidden text-ink ${map.id === "hall" ? "bg-[#2f6e8f]" : map.id === "market" || map.id === "khu_nha" ? "bg-[#2f5e7a]" : map.id === "bai_dat" ? "bg-[#59616a]" : map.id === "ham_ngam" ? "bg-[#2e2c2a]" : map.id === "mo_da" ? "bg-[#4f4841]" : map.id === "song_cai" ? "bg-[#3f7478]" : map.id === "rung_tram" ? "bg-[#3f5a2c]" : "bg-[#5a8f32]"}`} data-compact-hud={compact ? "" : undefined}>
      <GameCanvas
        ref={canvasRef}
        roomId={room.id}
        localId={accountId}
        mapId={travel.mapId}
        arrive={travel.arrive}
        world={worldMode ? worldZones : null}
        travelKey={travel.key}
        arriveWorld={travel.world ?? null}
        onZoneChange={onZoneChange}
        onAoiChange={onAoiChange}
        onWorldFailed={onWorldFailed}
        onGate={onGate}
        initial={{ name: myName, badges: myBadges, look: myLook }}
        isMember={(id) => memberIds.has(id)}
        isHere={(id) => isHereOn(presence, id, inWorld ? aoi : travel.mapId)}
        onInteract={onInteract}
        onPromptChange={setPrompt}
        onActorClick={setCard}
        onConnectionChange={setConnected}
        onLookChanged={refresh}
        onFishingInput={onFishingInput}
        onPlotChanged={farm.data.plotChanged}
        onRingHint={rings.hint}
        onLocalMove={farm.moved}
        onFirstFrame={onFirstFrame}
        onUnsupported={onUnsupported}
        onFatal={onFatal}
        onLift={lift.onMessage}
        onLiftLost={lift.onLost}
      />
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 z-40 bg-black transition-opacity duration-200 motion-reduce:transition-none ${fading ? "opacity-100" : "opacity-0"}`}
      />
      {trip && !faint && (
        <RoadTripOverlay
          look={liftTrip.look}
          pillion={liftTrip.pillion}
          canSkip={liftTrip.canSkip}
          toMarket={trip.toMarket}
          destName={trip.to.map === "khu_nha" || mapId === "khu_nha" ? CITY_PLACES[trip.to.map].name : undefined}
          vehicle={trip.vehicle}
          durationMs={trip.vehicle?.tripMs ?? WALK_TRIP_MS}
          coins={fishing.data.state?.coins ?? null}
          onArrive={() => {
            const to = trip.to;
            setTrip(null);
            travelTo(to);
          }}
          onSkip={skipRoad}
        />
      )}
      {inWorld && <ZoneToast zone={zone} />}{/* P2: the district I walk into */}
      {faint && <FaintOverlay untilMs={faint.until} serverNowMs={faint.serverNow} clientAtPerfMs={faint.at} onDone={endFaint} cause={faint.cause} count={vitalsState?.faintCount ?? 0} />}

      {compact ? (
        <>
          <MobileMenuButton open={drawer} onOpen={() => { setSheet(null); setDrawer(true); }}
            badge={hudGroups.some((g) => !!g.badge)}
            vitals={{
              hunger: vitals.state?.hunger ?? null, thirst: vitals.state?.thirst ?? null,
              stamina: profs.staminaValue === null ? null : (profs.staminaValue / (profs.stamina?.max ?? 100)) * 100,
              coins: fishing.data.state?.coins ?? null,
            }} />
          <MobileDrawer open={drawer} items={drawerItems} onClose={closeDrawer} onPick={(id) => { setDrawer(false); setSheet(id); }} />
          <MobileSheet id="status" title="🧑 Trạng thái" open={sheet === "status"} onClose={closeSheet}>
            <div className="flex flex-col gap-2 [&_[data-testid=player-hud]]:shadow-none">
              {statusCard}
              {countsBox}
              <div className="flex flex-wrap gap-1.5">{nowPlaying}</div>
            </div>
          </MobileSheet>
          {hudGroups.map((g) => (
            <MobileSheet key={g.id} id={g.id} title={`${g.icon} ${g.label}`} open={sheet === g.id} onClose={closeSheet}>
              <div className="flex flex-col gap-2">
                {g.id === "quests" && hudSlotBox}
                {g.content}
              </div>
            </MobileSheet>
          ))}
          <MobileSheet id="ride" title="🚗 Phương tiện" open={sheet === "ride"} onClose={closeSheet}>
            {ownedVehicles(vehicles.owned).length === 0 && !riding ? (
              <NoRide onMap={() => { setSheet(null); openWorldMap(); }} />
            ) : <div className="flex flex-wrap items-start gap-1.5">{rideBox}</div>}
          </MobileSheet>
          <MobileSheet id="chat" title="💬 Chat" open={sheet === "chat"} onClose={closeSheet}>
            <div className="flex justify-center pt-1 [&_.w-\[min\(40rem\,calc\(100vw-1rem\)\)\]]:w-full">{chatBar}</div>
          </MobileSheet>
          {!drawer && sheet === null && <ChatFab onOpen={() => setSheet("chat")} />}
        </>
      ) : (
      <div className="pointer-events-none absolute left-[max(0.5rem,env(safe-area-inset-left))] right-[max(0.5rem,env(safe-area-inset-right))] top-[max(0.5rem,env(safe-area-inset-top))] z-10 flex flex-wrap items-start justify-between gap-2 pointer-coarse:right-16">
        {/* the left column: who I am and how I am (the status card), the toolbar, then the situational chips */}
        <div className="pointer-events-none flex w-[20rem] max-w-[calc(100vw-1rem)] flex-col items-stretch gap-1.5">
          {statusCard}
          {/* the HUD menu: a few grouped entry points (⚙️ Cài đặt · 🎒 Túi đồ · 🧭 Hoạt động · 📜 Nhiệm vụ), all closed for a
              newcomer; the ride button stays out as the one quick action */}
          <div className="pointer-events-none flex items-start gap-1.5">
            <HudMenu groups={hudGroups} open={hudGroup} onOpen={setHudGroup} />
            {rideBox}
          </div>
          {hudSlotBox}
        </div>
        {countsBox}
        {nowPlaying}
      </div>
      )}

      <div className={`pointer-events-none absolute left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-2 ${compact ? "top-[max(2.5rem,calc(env(safe-area-inset-top)+2.25rem))] max-w-[calc(100vw-14rem)]" : "top-1/3"}`} role="status">
        {toast && <p className={`pch font-vt ${compact ? "px-2 py-0.5 text-base leading-tight" : "px-3 py-1.5 text-xl"}`} data-testid="hud-toast">{toast}</p>}
        {skipped && (
          <p className="pch px-3 py-1 font-vt text-lg">
            ⚡ Đã bỏ qua: {getCategoryLabel(skipped.category)} ({formatClock(skipped.start * 1000)} - {formatClock(skipped.end * 1000)})
          </p>
        )}
      </div>

      {card && (
        <div className="pch absolute left-1/2 top-1/4 z-20 flex -translate-x-1/2 items-center gap-2 p-2 font-vt text-lg leading-tight">
          <SpritePreview look={looks.get(card) ?? DEFAULT_LOOK} scale={2} className="rounded-sm bg-parchment" />
          <div className="flex flex-col">
            <span className="text-xl">{cardMember?.username ?? cardPresence?.name ?? "Khách"}</span>
            {card === roles.adminAccountId && <span>👑 Chủ phòng</span>}
            {card === roles.djAccountId && <span>🎧 DJ</span>}
            <span className="opacity-80">{cardWhere}</span>
            {card !== accountId && cardMember && (                                   // v21 economy
              <button type="button" className="pch-btn mt-1 self-start" data-testid="trade-start"
                onClick={() => { const who = card; setCard(null); void trade.start(who).then((err) => { if (err) showToast(err); }); }}>
                🤝 Giao dịch
              </button>
            )}
          </div>
          <button type="button" className="pch-btn self-start" onClick={() => setCard(null)} aria-label="Đóng">✕</button>
        </div>
      )}

      <WorldHud token={token} roomId={room.id} accountId={accountId} isOwner={isOwner} mapId={map.id} canvas={getCanvas}
        blocked={blocking || faint !== null || trip !== null} toast={showToast} onCoins={reloadCoins}
        onWeather={() => void roomWeather.reload()} onPanel={setWorldOpen} />{/* v21 world (0075) */}
      <ForestHud token={token} mapId={map.id} canvas={getCanvas} blocked={blocking || faint !== null || trip !== null}
        toast={showToast} onCoins={reloadCoins} onPanel={setForestOpen} />{/* 0096 forest */}
      <HeatActions heat={heat} hidden={blocking || faint !== null || trip !== null || fishing.net !== null}
        onNet={fishing.netReady && fishing.cast.phase === "idle" ? fishing.throwNet : null}
        onGroundbait={fishing.groundbaitReady && fishing.cast.phase === "idle"
          ? (cell) => fishing.throwGroundbait(fishing.groundbaitReady!, cell) : null} />{/* 0110 */}
      {prompt && !blocking && !(compact && fishing.cast.phase !== "idle") && (
        <button
          type="button"
          onClick={() => canvasRef.current?.interact()}
          className={`pch-btn pch-btn-primary absolute left-1/2 z-10 -translate-x-1/2 ${compact ? "bottom-[max(3.75rem,calc(env(safe-area-inset-bottom)+3.25rem))] max-w-[calc(100vw-20rem)] truncate text-base" : "bottom-24 text-xl"}`}
          data-testid="hud-prompt"
        >
          <span className="pointer-coarse:hidden">E · </span>
          {riding && interactBlocked(riding, prompt.kind) ? dismountText(prompt.prompt) : farmPrompt(prompt) ?? miningPrompt(prompt) ?? promptText(prompt)}
        </button>
      )}
      <LiftHud lift={lift} keyEnabled={!blocking && faint === null && trip === null} promptShown={prompt !== null} />{/* v18.13 */}

      <FishingOverlays
        fishing={fishing}
        onSail={explore.rowOut}
        onDetect={explore.detect}
        // the bag's farm tools, once the field has loaded and the catalog has them (before 0016 it has none)
        farm={farm.data.state && farm.data.catalog?.items.some((i) => i.kind === "tool")
          ? {
            mine: farm.data.state.mine, items: farm.data.catalog.items, critters: farm.data.catalog.critters, now: farm.now, busy: farm.busy,
            onLoad: (id) => void farm.loadSprayer(id),
          }
          : null}
      />
      <FarmOverlays farm={farm} me={accountId} onField={map.id === "field"} panelOpen={panelOpen} dog={coopDog} />
      <ExploreOverlays explore={explore} mapId={map.id} idle={!blocking && fishing.cast.phase === "idle" && faint === null} />{/* v22 (0086) */}
      <StoryLayer story={story} mapId={travel.mapId} resume={onInteract} compact={compact} onExpand={() => setSheet("quests")}
        getLocalPos={inWorld ? undefined : () => canvasRef.current?.localPos() ?? null} />{/* 0114: Chuyện làng (lib/game/story) */}
      <MiningOverlays m={mining} showChip={map.id === "mo_da" || Object.keys(mining.state?.bag ?? {}).some((k) => k.startsWith("pot_")) || (mining.state?.buffs.length ?? 0) > 0} />{/* v21 Mỏ đá */}
      <CardOverlays cards={cards} me={accountId} coins={fishing.data.state?.coins ?? null} looks={looks} />
      <TouchControls disabled={blocking || faint !== null || trip !== null || (compact ? drawer || sheet !== null || story.dialog !== null : hudGroup !== null)} />{/* phones: stick + E / Space */}
      <RotateOverlay />

      <div className={`pointer-events-none absolute bottom-18 right-3 z-10 ${compact ? "!hidden" : ""} ${miniOpen === false ? "hidden" : miniOpen ? "block" : "hidden sm:block"} pointer-coarse:hidden`}>
        {inWorld ? <WorldMiniMap getWorldPos={getWorldPos} getMarks={getMapMarks} zone={zone} waypoints={wpMarks} onOpenMap={openWorldMap} /> : <MiniMap mapId={travel.mapId} getLocalPos={() => canvasRef.current?.localPos() ?? null} onOpenMap={openWorldMap} />}
      </div>
      <button type="button" className={`pch-btn pointer-events-auto absolute right-[max(0.75rem,env(safe-area-inset-right))] top-[max(0.5rem,env(safe-area-inset-top))] z-10 hidden h-11 min-w-11 px-2 py-1 font-vt text-lg ${compact ? "" : "pointer-coarse:inline-flex pointer-coarse:items-center pointer-coarse:justify-center"}` } onClick={openWorldMap} aria-label="Mở bản đồ thế giới">🗺️</button>

      <div ref={bottomRef} className="pointer-events-none absolute inset-x-0 bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-10 flex justify-center">
        {!compact && chatBar}
      </div>

      {panel === "queue" && <QueuePanel room={room} derived={derived} role={role} token={token} onClose={close} />}
      {panel === "board" && (
        <RoomChartModal room={room} queue={state.queue} current={derived.current} roomId={room.id} token={token} onClose={close} />
      )}
      {panel === "settings" && (
        <SettingsDialog room={room} members={members} roomId={room.id} token={token} myMemberId={myMemberId} isAdmin={role.isAdmin} onClose={close} />
      )}
      {panel === "members" && (
        <ParchmentModal title={`👥 Thành viên (${onlineIds.length})`} onClose={close}>
          <MemberList members={members} room={room} onlineIds={onlineIds} isAdmin={role.isAdmin} token={token} myMemberId={myMemberId} />
        </ParchmentModal>
      )}
      {helpOpen && <HotkeysHelp onClose={() => setHelpOpen(false)} />}
      <ChatDrawer
        isOpen={panel === "chat"}
        onClose={close}
        roomId={room.id}
        token={token}
        accountId={accountId}
        isAdmin={role.isAdmin}
        members={members}
        room={room}
      />
      {panel === "dog" && dog.dog && (
        <DogPanel dog={dog.dog} food={dog.food} busy={dog.busy} onFeed={() => void dog.feed()}
          onRename={dog.rename} onPet={() => void dog.pet()} onClose={close} />
      )}
      {panel === "wardrobe" && savedLook && (
        <CharacterEditor
          mode="edit"
          initial={savedLook}
          token={token}
          onSaved={onSaved}
          onClose={close}
          onBackToClassic={onExitGame}
          onOpenStore={() => showToast("Ra Chợ Lớn (cổng phía đông sảnh) để mua đồ mới nhé!")}
        />
      )}
      {panel === "restaurant" && (
        <RestaurantModal
          token={token}
          fish={fishing.data.state?.fish ?? []}
          rarityOf={(id) => fishing.data.catalog?.species.find((s) => s.id === id)?.rarity ?? 1}
          speciesName={(id) => fishing.data.catalog?.species.find((s) => s.id === id)?.name ?? id}
          onAte={(_r, kind) => {
            canvasRef.current?.setVital?.(kind === "drink" ? "drink" : "eat", 3000);          // 3D wave 1
            void fishing.data.reload();
            void vitals.reload();
            showToast("Ngon quá! 😋");
          }}
          onClose={close}
        />
      )}
      {panel === "vehicle_shop" && (
        <VehicleShopModal
          token={token}
          owned={vehicles.owned}
          coins={fishing.data.state?.coins ?? null}
          onBought={() => {
            void vehicles.reload();
            void fishing.data.reload();
            showToast("Xe mới! Đi chợ nhanh hơn rồi 🎉");
          }}
          onSold={() => {
            void vehicles.reload();
            void fishing.data.reload();
            showToast("Đã bán xe lại cho ông Tám.");
          }}
          onClose={close}
        />
      )}
      {panel === "salon" && (
        <SalonModal
          token={token}
          look={myLook}
          coins={fishing.data.state?.coins ?? null}
          onStyled={(newLook) => {
            setSaved(newLook);
            canvasRef.current?.announceLook();
            void fishing.data.reload();
            setPanel(null);
            showToast("Tóc mới đẹp quá! ✨");
          }}
          onClose={close}
        />
      )}
      {panel === "fashion_store" && (
        <FashionStoreModal
          token={token}
          myAccountId={accountId}
          initialLook={myLook}
          members={members}
          onlineIds={onlineIds}
          onLookUpdated={(newLook) => {
            setSaved(newLook);
            canvasRef.current?.announceLook();
          }}
          onClose={close}
        />
      )}
      {panel === "news" && (
        <NewsModal feed={news.feed} onRead={news.markRead} onClose={close} />
      )}
      {newsPopupOpen && (
        <NewsModal key={news.popup.map((p) => p.id).join()} feed={news.feed} popup={news.popup} onClose={news.dismissPopup} />
      )}
      {changelogOpen && <ChangelogModal onClose={changelog.dismiss} />}
      <QuestPanels panel={panel} token={token} mapId={map.id} at={questAt} onOpen={(p) => setPanel(p)} onCoins={reloadCoins} onClose={close} />
      {panel === "professions" && token && (                                   // v21 (0077)
        <ProfessionModal token={token} state={profs.state} nowMs={profs.nowMs} onState={profs.apply} onCoins={reloadCoins} onClose={close} />
      )}
      {panel === "pet_shop" && (
        <PetShopModal
          token={token}
          state={pets.state}
          coins={fishing.data.state?.coins ?? null}
          onState={(s) => {
            pets.apply(s);
            if (s.coins !== undefined) void fishing.data.reload();
          }}
          onOpenCenter={() => setPanel("pet_center")}
          onClose={close}
        />
      )}
      {panel === "pet_center" && (
        <PetCenterModal
          token={token}
          roomId={room.id}
          pets={pets.state}
          onPets={pets.apply}
          coins={fishing.data.state?.coins ?? null}
          onCoins={() => void fishing.data.reload()}
          bag={fishing.data.state?.fish ?? []}
          species={fishing.data.catalog?.species ?? []}
          onBagChanged={() => void fishing.data.reload()}
          onClose={close}
        />
      )}
      {panel === "motel" && (
        <MotelModal
          token={token}
          state={motel.state}
          coins={fishing.data.state?.coins ?? null}
          look={myLook}
          onState={(s) => {
            motel.apply(s);
            if (s.coins !== undefined) void fishing.data.reload();
          }}
          onSleep={(on) => canvasRef.current?.setVital?.(on ? "sleep" : null)}
          onClose={close}
        />
      )}
      {panel === "apartment" && (
        <ApartmentModal
          token={token}
          roomId={room.id}
          state={apt.state}
          coins={fishing.data.state?.coins ?? null}
          onState={(s) => {
            apt.apply(s);
            if (s.coins !== undefined) void fishing.data.reload();
          }}
          onEnter={(l) => {
            setPanel(null);
            setInside(l);
          }}
          onClose={close}
        />
      )}
      {panel === "furniture_shop" && (
        <FurnitureShopModal
          token={token}
          coins={fishing.data.state?.coins ?? null}
          storage={apt.state?.storage ?? []}
          onState={(s) => {
            apt.apply(s);
            if (s.coins !== undefined) void fishing.data.reload();
          }}
          onClose={close}
        />
      )}
      {inside && (
        <InteriorView
          key={inside.no}
          token={token}
          roomId={room.id}
          me={{ id: accountId, name: myName, look: myLook }}
          layout={inside}
          apt={apt.state}
          bag={fishing.data.state?.fish ?? []}
          speciesName={(id) => fishing.data.catalog?.species.find((s) => s.id === id)?.name ?? id}
          onStorageChanged={() => void reloadApt()}
          onBagChanged={() => void fishing.data.reload()}
          onAdmit={(id, yes) => { aptAdmit(token, id, yes).then(apt.apply, () => showToast("Có lỗi, thử lại sau nhé.")); }}
          onSlept={motel.apply}
          onDuck={duckRoom}
          onLeave={leaveHome}
        />
      )}
      {panel === "estate" && (                                             // v19.4
        <EstateModal
          token={token}
          coins={fishing.data.state?.coins ?? null}
          hasHome={apt.state?.mine != null || houses.state?.mine != null || houses.state?.tenancy != null}
          onChanged={() => {
            void fishing.data.reload();
            void reloadApt();
            void reloadHouses();
          }}
          onClose={close}
        />
      )}
      {panel === "player_market" && (                                      // v21 economy
        <PlayerMarketModal token={token} onChanged={() => { void fishing.data.reload(); refreshMail(); }} onClose={close} />
      )}
      {panel === "mailbox" && token && (                                    // 0111 Hòm thư
        <MailboxModal token={token} box={mail.box} onBox={mail.apply} onChanged={() => void fishing.data.reload()} onClose={close} />
      )}
      {panel === "player_stalls" && (                                      // v21 economy
        <StallModal token={token} onChanged={() => { void fishing.data.reload(); refreshMail(); }} onClose={close} onStalls={(stalls) => canvasRef.current?.setLiveInputs?.({ stalls })} />
      )}
      {trade.done && <TradeDoneFx key={trade.done.k} coins={trade.done.coins} onDone={trade.clearDone} />}{/* v22 (0086) */}
      {trade.state?.trade && (                                              // v21 economy
        <TradeWindow key={trade.state.trade.id} token={token} trade={trade.state.trade} onState={trade.apply}
          onChanged={() => void fishing.data.reload()} />
      )}
      {panel === "lot" && lotNo !== null && !building && (
        <LotModal
          token={token}
          roomId={room.id}
          lot={lotNo}
          state={houses.state}
          coins={fishing.data.state?.coins ?? null}
          hasFlat={apt.state?.mine != null}
          onState={(s) => {
            houses.apply(s);
            if (s.coins !== undefined) void fishing.data.reload();
            void reloadApt();
          }}
          onBuild={() => setBuilding(true)}
          onEnter={(l) => {
            setPanel(null);
            setInsideHouse(l);
          }}
          onClose={close}
        />
      )}
      {panel === "lot" && building && houses.state?.mine && (
        <HouseBuilder
          key={houses.state.mine.no}
          token={token}
          lot={houses.state.mine.no}
          grid={houses.state.lots.find((l) => l.no === houses.state?.mine?.no)?.grid ?? null}
          roof={houses.state.lots.find((l) => l.no === houses.state?.mine?.no)?.roof ?? "ngoi"}
          coins={fishing.data.state?.coins ?? null}
          hasTenants={houses.state.mine.rooms.some((r) => r.tenantName !== null)}
          onState={(s) => {
            houses.apply(s);
            if (s.coins !== undefined) void fishing.data.reload();
            void reloadApt();
          }}
          onClose={() => setBuilding(false)}
        />
      )}
      {insideHouse && (
        <HouseView
          key={insideHouse.lot}
          token={token}
          roomId={room.id}
          me={{ id: accountId, name: myName, look: myLook }}
          layout={insideHouse}
          storage={apt.state?.storage ?? []}
          bag={fishing.data.state?.fish ?? []}
          speciesName={(id) => fishing.data.catalog?.species.find((s) => s.id === id)?.name ?? id}
          onStorageChanged={() => void reloadApt()}
          onBagChanged={() => void fishing.data.reload()}
          onSlept={motel.apply}
          onDuck={duckRoom}
          onLeave={leaveHome}
        />
      )}
      {(panel === "umbrella_stall" || panel === "umbrellas") && <UmbrellaModal shop={panel === "umbrella_stall"} onClose={close} />}
      {panel === "fight_practice" && <FightOverlay look={myLook} name={myName} onClose={close} {...practiceFighter(myLook, dojo.state)} />}{/* v20.1 */}
      {panel === "dojo" && token && (                                     // v20.2
        <Dojo
          token={token}
          look={myLook}
          name={myName}
          coins={fishing.data.state?.coins ?? null}
          dojo={dojo}
          onLook={(newLook) => {
            setSaved(newLook);
            canvasRef.current?.announceLook();
          }}
          onCoins={() => void fishing.data.reload()}
          onVitals={() => void reloadVitals()}
          onToast={showToast}
          onClose={close}
        />
      )}
      {panel === "ring" && !rings.active && (                              // v20.3: my corner's ready screen
        <RingReady
          rings={rings}
          roomId={room.id}
          accountId={accountId}
          myLook={myLook}
          lookOf={(id) => looks.get(id) ?? null}
          onClose={close}
        />
      )}
      {panel === "ring_board" && token && <RingBoard token={token} roomId={room.id} onClose={close} />}{/* v20.3 */}
      {rings.active && token && (() => {                                  // v20.3: a ring match (also after a reload)
        const act = rings.active;
        const foe = act.foe;
        const foeLook = (foe && looks.get(foe.id)) || DEFAULT_LOOK;
        const foeName = foe?.name ?? "Đối thủ";
        return (
          <PvpFight
            key={act.id}
            token={token}
            roomId={room.id}
            ring={act.ring}
            match={act}
            me={accountId}
            foeId={foe?.id ?? ""}
            names={act.side === 1 ? [myName, foeName] : [foeName, myName]}
            looks={act.side === 1 ? [myLook, foeLook] : [foeLook, myLook]}
            clock={rings.clock}
            resume={act.resumed}
            onDone={() => {
              rings.finish();
              setPanel(null);
              void fishing.data.reload();
              void reloadVitals();
            }}
            onRematch={(stake) => void rings.offer(act.ring, stake, act.params.delay ?? 3).then(() => setPanel("ring"))}
            onLeave={() => void rings.leave(act.ring)}
            onToast={showToast}
          />
        );
      })()}
      {panel === "underground" && !ug.active && (                         // v20.4 anh Tư Sẹo's panel
        <UndergroundPanel ug={ug} accountId={accountId} tab={ugTab} onTab={setUgTab} nowMs={ugNowMs} onClose={close} />
      )}
      {isCalled(ug.state) && !ug.active && ug.state?.mine && (            // v20.4 a called match: Sẵn sàng
        <UgCall ug={ug} mine={ug.state.mine} roomId={room.id} accountId={accountId} nowMs={ugNowMs} />
      )}
      {knocking && (                                                      // v20.4 the knock on the hatch
        <div className="pointer-events-none fixed inset-x-0 top-1/3 z-40 flex justify-center" role="status">
          <p className="pch px-3 py-1 font-vt text-xl motion-safe:animate-pulse">Cộc… cộc… cộc… cốc cốc</p>
        </div>
      )}
      {ug.active && token && ug.active.kind === "ug_ladder" && (() => {   // v20.4 a ladder match against the floor's boss
        const act = ug.active;
        const boss = bossOf(Number(act.ref ?? 0));
        const bossStyle = boss ? martialByKey(boss.style) : null;
        const mine = martialById(act.params.p1.style) ?? MARTIAL[0];
        const done = () => {
          setUgResult(null);
          ug.finish();
          void fishing.data.reload();
          void reloadVitals();
        };
        return ugResult ? (
          <div className="game-ui fixed inset-0 z-50">
            <ResultCard result={ugResult} side={1} onRematch={null} onLeave={() => { done(); setPanel(null); }} onClose={() => { done(); setPanel("underground"); }} />
          </div>
        ) : (
          <ExamFight
            key={act.id}
            token={token} match={act} clock={ug.clock} look={myLook} name={myName} master={mine} myRank={act.params.p1.rank}
            arena="ham_ngam"
            foe={{ name: boss?.name ?? "Trùm", look: (bossStyle ?? mine).masterLook, style: act.params.p2.style }}
            onResult={setUgResult}
            onFlag={() => showToast("Trận không hợp lệ — hệ thống đã ghi nhận.")}
          />
        );
      })()}
      {ug.active && token && ug.active.kind !== "ug_ladder" && (() => {   // v20.4 a rated or cup match in the cage
        const act = ug.active;
        const foe = act.foe;
        const foeLook = (foe && looks.get(foe.id)) || DEFAULT_LOOK;
        const foeName = foe?.name ?? "Đối thủ";
        return (
          <PvpFight
            key={act.id}
            token={token}
            roomId={room.id}
            ring={0}
            match={{ id: act.id, params: act.params, startedAtMs: act.startedAtMs, side: act.side, stake: act.entry }}
            me={accountId}
            foeId={foe?.id ?? ""}
            names={act.side === 1 ? [myName, foeName] : [foeName, myName]}
            looks={act.side === 1 ? [myLook, foeLook] : [foeLook, myLook]}
            clock={ug.clock}
            resume={act.resumed}
            topic={matchTopic(room.id, act.id)}
            arena="ham_ngam"
            onDone={() => {
              ug.finish();
              void fishing.data.reload();
              void reloadVitals();
            }}
            onRematch={null}
            onLeave={() => setPanel(null)}
            onToast={showToast}
          />
        );
      })()}
      {panel === "ug_watch" && token && !ug.active && (() => {            // v20.4 watching the cage
        const live = (ug.state?.live ?? []).find((m) => m.ready === 3);
        if (!live) return null;
        return (
          <SpectatorView
            key={live.id}
            token={token} roomId={room.id} me={accountId} match={live}
            looks={[looks.get(live.p1) ?? DEFAULT_LOOK, looks.get(live.p2) ?? DEFAULT_LOOK]}
            onClose={close}
          />
        );
      })()}
      {panel === "profile" && token && (                                   // v21 progression
        <ProfileModal token={token} state={progress.state} busy={progress.busy} onSetTitle={(id) => void progress.setTitle(id)}
          onTravel={(id) => void teleport(id)} onClose={close} />
      )}
      {panel === "city_map" && (
        <CityMapModal
          current={travel.mapId}
          counts={{ hall: counts.hall.length, pond: counts.pond.length, field: counts.field.length, market: counts.market.length, khu_nha: counts.khu_nha.length, bai_dat: counts.bai_dat.length, ham_ngam: 0, mo_da: counts.mo_da.length, song_cai: counts.song_cai.length, rung_tram: counts.rung_tram.length }}
          onClose={close}
          getWorldPos={inWorld ? getWorldPos : getMapPos2d}
          getMarks={inWorld ? getMapMarks : undefined}
          waypoints={wpMarks}
          onWaypoint={inWorld ? onWaypoint : undefined}
        />
      )}
      {creating && (
        <CharacterEditor mode="create" initial={DEFAULT_LOOK} token={token} onSaved={onSaved} onClose={onExitGame} onBackToClassic={onExitGame} />
      )}
      {weatherDialog && isOwner && (
        <WeatherLocationDialog current={weatherSource.loc} onPick={weatherSource.setLoc} onClose={() => setWeatherDialog(false)} />
      )}
      {anticheat.modal && <AnticheatModal kind={anticheat.modal} reason={anticheat.reason} onClose={anticheat.dismiss} />}
    </div>
    </UmbrellaContext.Provider>
    </HudSlotContext.Provider>
  );
}
