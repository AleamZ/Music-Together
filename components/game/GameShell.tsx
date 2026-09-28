"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import type { Interactable, MapId, Spot } from "@/lib/game/maps/types";
import { overlayLocks } from "@/lib/game/overlays";
import { skipTrip } from "@/lib/game/travel/rpc";
import { CAR_LEFT_TEXT, canRide, dismountText, interactBlocked, mountRefusal } from "@/lib/game/travel/ride";
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
import CityMapModal from "./CityMapModal";
import CardOverlays from "./cards/CardOverlays";
import CardSeatChip from "./cards/CardSeatChip";
import CharacterEditor from "./CharacterEditor";
import DogPanel from "./farm/DogPanel";
import FarmOverlays from "./farm/FarmOverlays";
import FaintOverlay from "./FaintOverlay";
import FightOverlay from "./fight/FightOverlay";
import Dojo from "./fight/Dojo";
import { useDojo } from "@/hooks/useDojo";
import { practiceFighter } from "@/lib/game/fight/dojo-gates";
import FashionStoreModal from "./FashionStoreModal";
import RestaurantModal from "./RestaurantModal";
import RideButton from "./RideButton";
import LiftHud from "./LiftHud";
import KeyBadge from "./KeyBadge";
import HotkeysHelp from "./HotkeysHelp";
import { useHotkeys } from "@/hooks/useHotkeys";
import { useLift } from "@/hooks/useLift";
import RoadTripOverlay from "./RoadTripOverlay";
import VehicleShopModal from "./VehicleShopModal";
import PetShopModal from "./PetShopModal";
import { usePets } from "@/hooks/usePets";
import MotelModal from "./MotelModal";
import { useMotel } from "@/hooks/useMotel";
import { restWalk } from "@/lib/game/housing/motel";
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
import { petSpeed } from "@/lib/game/pets/model";
import { followingPet, lookOf, myPetCode } from "@/lib/game/pets/rpc";
import SalonModal from "./SalonModal";
import RatChip from "./farm/RatChip";
import { FarmTasksButton } from "./farm/FarmTasks";
import FishingHud, { CoinsChip } from "./fishing/FishingHud";
import FishingOverlays from "./fishing/FishingOverlays";
import GameCanvas, { type GameCanvasHandle } from "./GameCanvas";
import HudChatBar from "./HudChatBar";
import HudNowPlaying from "./HudNowPlaying";
import MapCounts from "./MapCounts";
import MiniMap from "./MiniMap";
import NewsModal from "./NewsModal";
import ChangelogModal from "./news/ChangelogCarousel";
import { useChangelogPopup } from "@/lib/game/news/changelog-seen";
import { ParchmentModal } from "./Parchment";
import QueuePanel from "./QueuePanel";
import SpritePreview from "./SpritePreview";
import VitalsHud from "./VitalsHud";
import WeatherChip from "./WeatherChip";
import PersonalSettings from "./PersonalSettings";
import { loadWeatherFx, saveWeatherFx } from "@/lib/game/weather/fx";
import type { WeatherFx } from "@/lib/game/art/weather";
import WeatherLocationDialog from "./WeatherLocationDialog";

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
  | "queue" | "board" | "settings" | "members" | "chat" | "wardrobe" | "fashion_store" | "restaurant" | "vehicle_shop" | "salon" | "dog" | "city_map" | "news" | "pet_shop" | "umbrella_stall" | "umbrellas" | "motel" | "apartment" | "furniture_shop" | "lot" | "estate" | "fight_practice" | "dojo" | null;

/** The toasts the vitals refusals map to (v18.3): seeing one means the bars are stale. */
const VITALS_TEXTS = new Set(["too hungry", "too thirsty", "fainted", "exhausted"].map((m) => vitalsErrorMessage(m)));

/** A portal fades to dark in FADE_MS, the new map starts, and it fades back in after the map's first frame. */
const FADE_MS = 250;

/** Game mode: the room world (hall, pond and field) and the parchment HUD. Music, queue, chat and roles are the same as the
 *  classic view. */
export default function GameShell({ view, derived, playback, sponsorBlock, onExitGame, onExhausted }: GameShellProps) {
  const { state, role, presence, onlineIds, token, accountId, username, myMemberId, setPresenceMap, setPresenceDog } = view;
  const room = state.room!;
  const { members } = state;
  const { admin_member_id, dj_member_id } = room;
  const canvasRef = useRef<GameCanvasHandle | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
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

  // --- where I am: game mode always starts in the hall; a portal fades out, switches the map, fades back in
  const [travel, setTravel] = useState<{ mapId: MapId; arrive: Spot | null }>({ mapId: "hall", arrive: null });
  const [fading, setFading] = useState(false);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const map = getMap(travel.mapId);
  useEffect(() => {
    setPresenceMap(travel.mapId);
  }, [travel.mapId, setPresenceMap]);
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

  const travelTo = useCallback((to: { map: MapId; arrive: Spot }) => {
    if (fadeTimer.current) return;
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
      setTravel({ mapId: to.map, arrive: to.arrive });
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
      mapId: travel.mapId, seating: getMap(travel.mapId).seating,
    }));
  }, [presence, members, admin_member_id, dj_member_id, accountId, looks, travel]);
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

  // --- farming: the field of this room, its panels, the due tasks, the plots on the canvas and the work progress
  const farm = useFarmController({
    token, roomId: room.id, accountId, mapId: travel.mapId, canvas: getCanvas, toast: gameToast,
    // the HUD's wallet is the fishing state's: fetch it again when the field moved my coins
    onCoinsChanged: () => void fishing.data.reload(),
  });
  const { interact: farmInteract, promptText: farmPrompt } = farm;

  // --- my dog (v17 §7.3, §12.3): learned on entering game mode, on the canvas behind me and in presence
  const petDog = useCallback(() => canvasRef.current?.petDog(), []);
  const dog = useDog({
    token, field: farm.data.state, petDog, setPresenceDog, toast: showToast, onCoinsChanged: () => void fishing.data.reload(),
  });
  const dogName = dog.dog?.name ?? null, dogCoat = dog.dog?.coat ?? null, dogHungry = dog.hungry;
  useEffect(() => {
    canvasRef.current?.setLocal({
      name: myName, badges: myBadges, look: myLook, dog: dogName !== null && dogCoat !== null ? { name: dogName, coat: dogCoat } : null, dogHungry,
    });
  }, [myName, myBadges, myLook, dogName, dogCoat, dogHungry]);
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
  const pets = usePets(token, onPetFound);
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
    canvasRef.current?.setHouses((houseLots ?? []).map((l) => ({ lot: l.no, owned: l.owned, grid: l.grid, roof: l.roof })));
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
  const rain = useRain({ token, canvasRef, fromVitals: vitalsState?.rain, raining: isRainy(weather?.kind), onCoinsChanged: reloadCoins, showToast });
  const rainCold = rain.cold;
  const starving = vitalsState ? isStarving(vitalsState) : false;
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
  const openOverlays = {
    panel: panel !== null || inside !== null || insideHouse !== null || building || helpOpen,fishingPanel: fishing.panel !== null || fishing.net !== null, creating, anticheatModal: anticheat.modal !== null,
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
    if (isRoadTrip(mapId, m)) setTrip({ to: door.to, toMarket: tripForward(mapId, m), vehicle: VEHICLES.find((x) => x.id === v) ?? null });
    else travelTo(door.to);
    return true;
  }, [mapId, cancelCast, travelTo]);
  const lift = useLift({
    canvasRef, riding, fainted: faint !== null, nameOf, toast: showToast, follow: followDriver,
    canAsk: riding === null && !rideBusy && !blocking,
    canCarry: riding !== null && trip === null && faint === null,
    inTransit: () => trip !== null || fadeTimer.current !== null,
  });
  const { portal: liftPortal } = lift;
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

  const onInteract = useCallback((it: Interactable) => {
    if (interactBlocked(riding, it.kind)) {
      showToast(dismountText(it.prompt));
      return;
    }
    switch (it.kind) {
      case "dj_booth":
        setPanel("queue");
        break;
      case "notice_board":
        setPanel("board");
        break;
      case "portal":
        if (!it.to) break;
        cancelCast();
        liftPortal(it.to.map);                                              // v18.13: my passenger comes along
        if (isRoadTrip(mapId, it.to.map)) {
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
      case "punch_bag":                                                     // v20.1
        setPanel("fight_practice");
        void reloadDojo();
        break;
      case "dojo":                                                          // v20.2
        setPanel("dojo");
        void reloadDojo();
        break;
      default:
        if (!farmInteract(it) && !cardsInteract(it) && !fishingInteract(it)) showToast("Sắp mở — chờ chút nhé!");
    }
  }, [travelTo, showToast, fishingInteract, farmInteract, cardsInteract, cancelCast, mapId, reloadVehicles, riding, vehicles.owned, refreshNews, reloadPets, liftPortal, reloadMotel, reloadApt, reloadHouses, reloadDojo]);

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
    : cardPresence?.map === "market" ? "🏮 Đang đi Chợ Lớn"
    : cardPresence?.map === "khu_nha" ? "🏘️ Đang ở Khu nhà" : "🎮 Đang dạo quanh sảnh";

  return (
    <UmbrellaContext.Provider value={{ rain, coins: fishing.data.state?.coins ?? null }}>
    <div className={`game-ui fixed inset-0 overflow-hidden text-ink ${map.id === "hall" ? "bg-[#2f6e8f]" : map.id === "market" || map.id === "khu_nha" ? "bg-[#2f5e7a]" : "bg-[#5a8f32]"}`}>
      <GameCanvas
        ref={canvasRef}
        roomId={room.id}
        localId={accountId}
        mapId={travel.mapId}
        arrive={travel.arrive}
        initial={{ name: myName, badges: myBadges, look: myLook }}
        isMember={(id) => memberIds.has(id)}
        isHere={(id) => isHereOn(presence, id, travel.mapId)}
        onInteract={onInteract}
        onPromptChange={setPrompt}
        onActorClick={setCard}
        onConnectionChange={setConnected}
        onLookChanged={refresh}
        onFishingInput={onFishingInput}
        onPlotChanged={farm.data.plotChanged}
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
      {faint && <FaintOverlay untilMs={faint.until} serverNowMs={faint.serverNow} clientAtPerfMs={faint.at} onDone={endFaint} cause={faint.cause} count={vitalsState?.faintCount ?? 0} />}

      <div className="pointer-events-none absolute inset-x-2 top-2 z-10 flex flex-wrap items-start justify-between gap-2">
        <div
          className="pch pointer-events-auto flex max-w-[calc(100vw-1rem)] items-center gap-1.5 p-1 font-vt text-base leading-none sm:max-w-md"
          data-testid="player-hud"
        >
          <SpritePreview look={myLook} scale={2} className="shrink-0 self-start rounded-sm bg-parchment" />
          <div className="flex min-w-0 flex-col gap-1">
            {/* row 1: who I am, my coins and the room's weather */}
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="min-w-0 max-w-36 truncate text-lg" title={`${myBadges ? `${myBadges} ` : ""}${myName}`}>
                {myBadges ? `${myBadges} ` : ""}{myName}
              </span>
              <CoinsChip state={fishing.data.state} />
              <WeatherChip
                weather={weather}
                tempC={weatherSource.tempC}
                isOwner={isOwner}
                needsLocation={weatherSource.status === "needed"}
                onOpenLocation={() => setWeatherDialog(true)}
              />
            </div>
            {!connected && <span className="text-sm opacity-80">Đang kết nối thế giới…</span>}
            {/* row 2: hunger and thirst, then the fishing or farm status (details in the tooltips) */}
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
              <VitalsHud state={vitals.state} />
              <HeatChips chips={heat.chips} />
              {motel.rested && <span data-testid="rest-chip" title="Ngủ ngon: đói, khát chậm hơn 30 %, đi nhanh hơn 7 %" className="whitespace-nowrap">😴 Ngủ ngon</span>}
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
            {/* row 3: the icon buttons (labels in the tooltips and for screen readers) */}
            <div className="flex flex-wrap items-center gap-1 [&_.pch-btn]:px-1.5 [&_.pch-btn]:py-0.5 [&_.pch-btn]:text-sm [&_.pch-btn]:leading-none">
              <button type="button" className="pch-btn relative" data-hotkey="wardrobe" title="Tủ đồ (I)" onClick={() => setPanel("wardrobe")} disabled={savedLook === null}>
                👕<span className="sr-only"> Tủ đồ</span><KeyBadge id="wardrobe" />
              </button>
              <button type="button" className="pch-btn relative" data-hotkey="bag" title="Giỏ đồ (B)" onClick={() => fishing.openPanel("bag")}>
                🎒<span className="sr-only"> Giỏ đồ</span><KeyBadge id="bag" />
              </button>
              {fishing.handFish !== null && (
                <button
                  type="button" className="pch-btn relative" data-hotkey="fish" aria-pressed={!fishing.fishStowed}
                  title={fishing.fishStowed ? "Lấy cá ra cầm trên tay (F)" : "Cất cá vào giỏ (F)"} onClick={fishing.toggleFishStowed}
                >
                  {fishing.fishStowed ? "🐟" : "🎒🐟"}<span className="sr-only">{fishing.fishStowed ? " Lấy cá ra" : " Cất cá"}</span><KeyBadge id="fish" />
                </button>
              )}
              {(rain.state?.umbrellas.length ?? 0) > 0 && (
                <button type="button" className="pch-btn relative" data-hotkey="umbrellas" title="Ô của tôi (cầm tay) (U)" onClick={() => setPanel("umbrellas")}>
                  ☂️<span className="sr-only"> Ô của tôi</span><KeyBadge id="umbrellas" />
                </button>
              )}
              {news.unread && (
                <span className="pch-btn relative cursor-default" title="Báo Làng có tin mới — ghé sạp báo ở sảnh" data-testid="news-hud">
                  📰<span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-600" aria-hidden="true" />
                  <span className="sr-only"> Báo Làng có tin mới</span>
                </span>
              )}
              {dog.dog && (
                <button type="button" className="pch-btn max-w-24 truncate" data-hotkey="dog" title={`Chó của bạn: ${dog.dog.name}${dog.hungry ? " (đang đói)" : ""} (P)`}
                  onClick={() => setPanel("dog")}>{dogHudText(dog.dog.name, dog.hungry)}</button>
              )}
              <RideButton
                owned={vehicles.owned}
                riding={riding}
                last={lastRide}
                keyEnabled={!blocking}
                onMount={mountOwn}
                onDismount={dismount}
              />
              {map.id === "field" && <FarmTasksButton urgent={farm.urgent} onClick={() => farm.openPanel({ kind: "tasks" })} />}
              <PersonalSettings weatherFx={weatherFx} onWeatherFx={changeWeatherFx} />
              <CameraZoomControl
                mapWidth={map.width}
                mapHeight={map.height}
                onZoomChange={(z) => canvasRef.current?.setZoom(z)}
              />
              <button type="button" className="pch-btn relative pointer-coarse:hidden" title="Phím tắt (H)" onClick={() => setHelpOpen(true)}>
                ⌨️<span className="sr-only"> Phím tắt</span><KeyBadge id="help" />
              </button>
            </div>
            <AnticheatChip secondsLeft={anticheat.secondsLeft} />
            {cards.seated && <CardSeatChip table={cards.seatTable} me={accountId} onOpen={() => cards.seated && cards.openPanel(cards.seated)} />}
          </div>
        </div>
        <div className="flex flex-col items-center gap-1">
          <MapCounts counts={counts} />
          {map.id === "field" && (
            <RatChip live={farm.data.state?.rats?.live.length ?? 0} onOpen={() => farm.openPanel({ kind: "handbook", tab: "rats" })} />
          )}
        </div>
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
      </div>

      <div className="pointer-events-none absolute left-1/2 top-1/3 z-20 flex -translate-x-1/2 flex-col items-center gap-2" role="status">
        {toast && <p className="pch px-3 py-1.5 font-vt text-xl">{toast}</p>}
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
          </div>
          <button type="button" className="pch-btn self-start" onClick={() => setCard(null)} aria-label="Đóng">✕</button>
        </div>
      )}

      <HeatActions heat={heat} hidden={blocking || faint !== null || trip !== null || fishing.net !== null}
        onNet={fishing.netReady && fishing.cast.phase === "idle" ? fishing.throwNet : null} />
      {prompt && !blocking && (
        <button
          type="button"
          onClick={() => canvasRef.current?.interact()}
          className="pch-btn pch-btn-primary absolute bottom-24 left-1/2 z-10 -translate-x-1/2 text-xl"
        >
          <span className="pointer-coarse:hidden">E · </span>
          {riding && interactBlocked(riding, prompt.kind) ? dismountText(prompt.prompt) : farmPrompt(prompt) ?? promptText(prompt)}
        </button>
      )}
      <LiftHud lift={lift} keyEnabled={!blocking && faint === null && trip === null} promptShown={prompt !== null} />{/* v18.13 */}

      <FishingOverlays
        fishing={fishing}
        // the bag's farm tools, once the field has loaded and the catalog has them (before 0016 it has none)
        farm={farm.data.state && farm.data.catalog?.items.some((i) => i.kind === "tool")
          ? {
            mine: farm.data.state.mine, items: farm.data.catalog.items, critters: farm.data.catalog.critters, now: farm.now, busy: farm.busy,
            onLoad: (id) => void farm.loadSprayer(id),
          }
          : null}
      />
      <FarmOverlays farm={farm} me={accountId} onField={map.id === "field"} panelOpen={panelOpen} dog={coopDog} />
      <CardOverlays cards={cards} me={accountId} coins={fishing.data.state?.coins ?? null} looks={looks} />

      <div className="pointer-events-none absolute bottom-18 right-3 z-10 hidden sm:block">
        <MiniMap mapId={travel.mapId} getLocalPos={() => canvasRef.current?.localPos() ?? null} />
      </div>

      <div ref={bottomRef} className="pointer-events-none absolute inset-x-0 bottom-2 z-10 flex justify-center">
        <HudChatBar
          onSend={(text) => send(formatChatMessageBody(text))}
          onReact={react}
          onOpenChat={() => setPanel("chat")}
          onOpenMembers={() => setPanel("members")}
          onlineCount={onlineIds.length}
          onExitGame={onExitGame}
        />
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
          onAte={() => {
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
      {panel === "pet_shop" && (
        <PetShopModal
          token={token}
          state={pets.state}
          coins={fishing.data.state?.coins ?? null}
          onState={(s) => {
            pets.apply(s);
            if (s.coins !== undefined) void fishing.data.reload();
          }}
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
      {panel === "city_map" && (
        <CityMapModal
          current={travel.mapId}
          counts={{ hall: counts.hall.length, pond: counts.pond.length, field: counts.field.length, market: counts.market.length, khu_nha: counts.khu_nha.length }}
          onClose={close}
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
  );
}
