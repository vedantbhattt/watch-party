"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getClientId, getSocket } from "../lib/socket";
import type { Ack, RoomSnapshot } from "../lib/protocol";
import { fuzzyMatches } from "../lib/search";

const movies = [
  { title: "Interstellar", genre: "Sci-Fi", year: "2014", image: "https://image.tmdb.org/t/p/w780/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg", description: "Love transcends dimensions.", tag: "A journey beyond the stars" },
  { title: "Inception", genre: "Sci-Fi", year: "2010", image: "https://image.tmdb.org/t/p/w780/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg", description: "Your mind is the scene of the crime.", tag: "One more layer" },
  { title: "Spider-Man: Across the Spider-Verse", genre: "Animation", year: "2023", image: "https://image.tmdb.org/t/p/w780/8Vt6mWEReuy4Of61Lnj5Xj704m8.jpg", description: "A universe of possibilities.", tag: "Every universe. Every feeling." },
  { title: "The Batman", genre: "Action", year: "2022", image: "https://image.tmdb.org/t/p/w780/74xTEgt7R36Fpooo50r9T25onhq.jpg", description: "Unmask the truth.", tag: "Gotham after dark" },
  { title: "Dune: Part Two", genre: "Sci-Fi", year: "2024", image: "https://image.tmdb.org/t/p/w780/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg", description: "The future is written in sand.", tag: "Destiny is calling" },
  { title: "Oppenheimer", genre: "Drama", year: "2023", image: "https://image.tmdb.org/t/p/w780/ptpr0kGAckfQkJeJIt8st5dglvd.jpg", description: "A world changed forever.", tag: "The weight of a decision" },
  { title: "The Martian", genre: "Adventure", year: "2015", image: "https://image.tmdb.org/t/p/w780/5aGhaIHYuQbqlHWvWYqMCnj40y2.jpg", description: "Bring him home.", tag: "Science meets survival" },
  { title: "The Grand Budapest Hotel", genre: "Comedy", year: "2014", image: "https://image.tmdb.org/t/p/w780/eWdyYQreja6JGCzqHWXpWHDrrPo.jpg", description: "A perfectly unexpected adventure.", tag: "A very unusual check-in" },
];
const categories = ["All films", "Sci-Fi", "Action", "Animation", "Drama", "Adventure", "Comedy"];
const featuredMovies = [movies[0], movies[1], movies[3]];

export default function Home() {
  const router = useRouter();
  const [activeCategory, setActiveCategory] = useState("All films");
  const [activeEra, setActiveEra] = useState("Any year");
  const [search, setSearch] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [name, setName] = useState("Host");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const [isHeroPaused, setIsHeroPaused] = useState(false);
  const featuredMovie = featuredMovies[featuredIndex];

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || isHeroPaused) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        setFeaturedIndex((current) => (current + 1) % featuredMovies.length);
      }
    }, 7200);
    return () => window.clearInterval(timer);
  }, [isHeroPaused]);

  const visibleMovies = useMemo(() => movies.filter((movie) => {
    const matchesCategory = activeCategory === "All films" || movie.genre === activeCategory;
    const year = Number(movie.year);
    const matchesEra = activeEra === "Any year" || (activeEra === "2010s" ? year >= 2010 && year < 2020 : year >= 2020 && year < 2030);
    return matchesCategory && matchesEra && fuzzyMatches(search, movie.title, movie.genre, movie.year, movie.description, movie.tag);
  }), [activeCategory, activeEra, search]);

  function saveName(cleanName: string) {
    try { sessionStorage.setItem("watch-party-name", cleanName); } catch { /* Private browsing may disable storage. */ }
  }

  function createRoom(movieTitle = "Choose a movie") {
    setError("");
    setBusy(true);
    const socket = getSocket();
    const clientId = getClientId();
    const cleanName = name.trim().slice(0, 24) || "Host";
    saveName(cleanName);
    if (!socket.connected) socket.connect();

    socket.timeout(8000).emit(
      "room:create",
      { clientId, name: cleanName, movieTitle },
      (timeoutError: Error | null, response: Ack<{ room: RoomSnapshot }> | undefined) => {
        setBusy(false);
        if (timeoutError) {
          setError("The room server did not respond. Check the terminal, then try again.");
          return;
        }
        if (!response || !response.ok) {
          setError(response?.error || "Unable to create room.");
          return;
        }
        router.push(`/room/${response.room.code}`);
      }
    );
  }

  function joinRoom() {
    const code = joinCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      setError("Enter the six-character code supplied by your host.");
      return;
    }
    setError("");
    setBusy(true);
    const socket = getSocket();
    const clientId = getClientId();
    const cleanName = name.trim().slice(0, 24) || "Guest";
    saveName(cleanName);
    if (!socket.connected) socket.connect();

    socket.timeout(8000).emit(
      "room:join",
      { code, clientId, name: cleanName },
      (timeoutError: Error | null, response: Ack<{ room: RoomSnapshot }> | undefined) => {
        setBusy(false);
        if (timeoutError) {
          setError("Could not reach the room server. Check the terminal and retry.");
          return;
        }
        if (!response || !response.ok) {
          setError(response?.error || "Could not join this room.");
          return;
        }
        router.push(`/room/${code}`);
      }
    );
  }

  return (
    <main className="relative isolate min-h-screen overflow-hidden bg-[#08090d] text-white selection:bg-violet-500/40">
      <header className="sticky top-0 z-30 border-b border-white/[0.08] bg-[#08090d]/85 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 md:px-10">
          <a href="#top" className="flex shrink-0 items-center gap-3" aria-label="Watchparty home">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600 text-xl font-black shadow-lg shadow-violet-950/50">w</span>
            <span className="text-xl font-bold tracking-tight">watch<span className="text-violet-400">party</span><span className="ml-2 rounded-md border border-white/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-zinc-500">beta</span></span>
          </a>
          <nav aria-label="Main navigation" className="hidden items-center gap-7 text-sm text-zinc-400 md:flex"><a href="#discover" className="nav-link transition hover:text-white focus-visible:outline-none focus-visible:text-white">Discover</a><a href="#rooms" className="nav-link transition hover:text-white focus-visible:outline-none focus-visible:text-white">Watch rooms</a><a href="#how" className="nav-link transition hover:text-white focus-visible:outline-none focus-visible:text-white">How it works</a></nav>
          <button disabled={busy} onClick={() => createRoom()} className="rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-black transition hover:bg-violet-100 disabled:cursor-wait disabled:opacity-50">{busy ? "Connecting…" : "+ Create room"}</button>
        </div>
      </header>

      <section id="top" className="relative isolate overflow-hidden">
        <div aria-hidden="true" className="ambient-orb pointer-events-none absolute -top-44 left-1/2 -z-10 h-[36rem] w-[36rem] -translate-x-1/2 rounded-full bg-violet-700/20 blur-[120px]" />
        <div aria-hidden="true" className="ambient-orb ambient-orb-delay pointer-events-none absolute right-[-12rem] top-56 -z-10 h-[28rem] w-[28rem] rounded-full bg-fuchsia-700/[0.09] blur-[110px]" />
        <div className="mx-auto grid max-w-7xl items-center gap-14 px-5 py-14 md:grid-cols-2 md:px-10 md:py-24">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-400/[0.08] px-3 py-2 text-xs font-semibold tracking-wide text-violet-200"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" /> YOUR PEOPLE. YOUR MOVIE NIGHT.</div>
            <h1 className="max-w-2xl text-5xl font-black leading-[1.05] tracking-[-0.045em] sm:text-6xl lg:text-7xl">Same movie.<br /><span className="bg-gradient-to-r from-violet-400 via-fuchsia-300 to-pink-300 bg-clip-text text-transparent">Same moment.</span><br />Different places.</h1>
            <p className="mt-6 max-w-lg text-base leading-7 text-zinc-400 md:text-lg">Turn a random night into a movie night. Bring your friends into one room, chat through the plot twists, and react together from anywhere.</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row"><button disabled={busy} onClick={() => createRoom()} className="rounded-xl bg-violet-600 px-6 py-4 font-bold shadow-lg shadow-violet-950/40 transition hover:bg-violet-500 disabled:opacity-50">{busy ? "Creating room…" : "Create a watch room ↗"}</button><a href="#discover" className="rounded-xl border border-white/10 bg-white/[0.03] px-6 py-4 text-center font-semibold transition hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.08]">Explore films ↓</a></div>
            <div id="rooms" className="glass-panel mt-8 scroll-mt-28 rounded-2xl border border-white/10 p-5 shadow-2xl shadow-black/10">
              <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Join your friends</h2><span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Have a code?</span></div>
              <label htmlFor="display-name" className="mt-4 block text-xs font-semibold tracking-wide text-zinc-500">DISPLAY NAME</label>
              <input id="display-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={24} className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 outline-none transition placeholder:text-zinc-600 focus:border-violet-400 focus:ring-2 focus:ring-violet-500/20" placeholder="Your name" />
              <form onSubmit={(e) => { e.preventDefault(); joinRoom(); }} className="mt-3 flex gap-2"><label htmlFor="join-code" className="sr-only">Room code</label><input id="join-code" value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} maxLength={6} autoComplete="off" className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-3 font-mono uppercase tracking-[0.2em] outline-none placeholder:font-sans placeholder:tracking-normal placeholder:text-zinc-600 focus:border-violet-400 focus:ring-2 focus:ring-violet-500/20" placeholder="ROOM CODE" /><button type="submit" disabled={busy} className="rounded-xl bg-white px-5 py-3 font-bold text-black transition hover:bg-violet-100 disabled:opacity-50">Join</button></form>
              {error && <p role="alert" className="mt-3 rounded-lg border border-rose-400/20 bg-rose-400/5 px-3 py-2 text-sm text-rose-200">{error}</p>}
            </div>
            <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-xs text-zinc-500"><span>◉ Real-time rooms</span><span>◉ Live chat</span><span>◉ Shared playback demo</span></div>
          </div>

          <div className="relative mx-auto w-full max-w-xl">
            <div className="absolute -inset-5 rounded-[2rem] bg-gradient-to-br from-violet-600/20 to-pink-600/10 blur-2xl" />
            <div className="cinema-frame relative rounded-[1.7rem] border border-white/10 bg-[#111219] p-3 shadow-2xl shadow-black/60" onMouseEnter={() => setIsHeroPaused(true)} onMouseLeave={() => setIsHeroPaused(false)} onFocusCapture={() => setIsHeroPaused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsHeroPaused(false); }}>
              <div className="relative overflow-hidden rounded-[1.2rem]">
                <img key={featuredMovie.title} src={featuredMovie.image} alt={`${featuredMovie.title} film poster`} className="hero-poster h-[370px] w-full object-cover sm:h-[480px]" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#111219] via-[#111219]/15 to-black/5" />
                <div className="absolute left-5 top-5 rounded-full border border-white/15 bg-black/40 px-3 py-1.5 text-[10px] font-bold tracking-[0.2em] text-violet-100 backdrop-blur-xl">TONIGHT&apos;S FEATURE · {featuredMovie.year}</div>
                <div role="group" aria-label="Choose featured movie" className="absolute right-5 top-5 flex items-center gap-1.5 rounded-full border border-white/15 bg-black/40 p-2.5 backdrop-blur-xl">
                  {featuredMovies.map((movie, index) => <button key={movie.title} type="button" aria-label={`Feature ${movie.title}`} aria-pressed={featuredIndex === index} onClick={() => setFeaturedIndex(index)} className={`h-1.5 rounded-full transition-all duration-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 ${featuredIndex === index ? "w-6 bg-violet-300" : "w-1.5 bg-white/45 hover:bg-white/90"}`} />)}
                </div>
                <div className="absolute bottom-6 left-5 right-5 sm:left-7 sm:right-7"><p className="text-xs font-bold tracking-[0.18em] text-violet-300">THE MOVIE NIGHT STARTS HERE</p><h2 className="mt-2 text-4xl font-black sm:text-5xl">{featuredMovie.title}</h2><p className="mt-2 max-w-sm text-sm leading-6 text-zinc-300">{featuredMovie.description}</p><button disabled={busy} onClick={() => createRoom(featuredMovie.title)} className="mt-5 rounded-xl bg-violet-600 px-5 py-3 text-sm font-bold shadow-lg shadow-violet-950/25 transition hover:-translate-y-0.5 hover:bg-violet-500 disabled:opacity-50">Start this movie night ↗</button></div>
              </div>
            </div>
            <div className="glass-float absolute -bottom-5 right-3 z-10 rounded-2xl border border-white/15 bg-[#171821]/75 px-4 py-3 shadow-2xl shadow-violet-950/30 backdrop-blur-2xl sm:right-7"><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-violet-200/65">A little thought</p><p className="mt-1 text-sm font-semibold">Together, even apart <span className="text-violet-300">✦</span></p></div>
          </div>
        </div>
      </section>

      <section id="discover" className="mx-auto max-w-7xl scroll-mt-24 px-5 py-14 md:px-10 md:py-20">
        <div className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between"><div><p className="mb-2 text-xs font-bold tracking-[0.22em] text-violet-400">FIND YOUR NEXT WATCH</p><h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Pick the vibe.</h2><p className="mt-2 text-sm text-zinc-500">Choose a title for your room; you can add an authorized video source inside it.</p></div><div className="w-full lg:max-w-xs"><label htmlFor="movie-search" className="sr-only">Search films</label><div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3"><span className="text-zinc-500">⌕</span><input id="movie-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search films or genres…" className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none placeholder:text-zinc-600" /><span className="text-xs text-zinc-600">{visibleMovies.length}</span></div><label htmlFor="movie-era" className="sr-only">Filter movies by decade</label><select id="movie-era" value={activeEra} onChange={(event) => setActiveEra(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-[#111219] px-3 py-3 text-sm text-zinc-300 outline-none focus:border-violet-400"><option>Any year</option><option>2010s</option><option>2020s</option></select></div></div>
        <div className="mb-6 flex gap-2 overflow-x-auto pb-2">{categories.map((category) => <button key={category} onClick={() => setActiveCategory(category)} aria-pressed={activeCategory === category} className={`whitespace-nowrap rounded-full px-4 py-2.5 text-sm font-medium transition ${activeCategory === category ? "bg-white text-black" : "border border-white/10 text-zinc-400 hover:border-white/20 hover:text-white"}`}>{category}</button>)}</div>
        {visibleMovies.length ? <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">{visibleMovies.map((movie) => <article key={movie.title} className="movie-card group overflow-hidden rounded-2xl border border-white/[0.08] bg-[#111219]"><div className="relative overflow-hidden bg-black"><img src={movie.image} alt={`${movie.title} poster`} loading="lazy" className="movie-poster h-72 w-full object-cover" /><span className="absolute left-3 top-3 rounded-lg border border-white/10 bg-black/65 px-2.5 py-1 text-xs backdrop-blur">{movie.year}</span><span className="absolute bottom-3 left-3 rounded-full bg-violet-600/90 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide">{movie.genre}</span></div><div className="p-4"><h3 className="min-h-12 text-lg font-bold leading-6">{movie.title}</h3><p className="mt-1 min-h-10 text-sm leading-5 text-zinc-500">{movie.description}</p><p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">{movie.tag}</p><button disabled={busy} onClick={() => createRoom(movie.title)} className="mt-4 w-full rounded-xl border border-white/10 py-3 text-sm font-semibold transition hover:border-violet-400/50 hover:bg-violet-500/10 disabled:opacity-50">Watch with friends ↗</button></div></article>)}</div> : <div className="rounded-2xl border border-dashed border-white/10 px-6 py-14 text-center"><p className="text-lg font-semibold">No films found</p><p className="mt-2 text-sm text-zinc-500">Try another title or choose a different category.</p><button onClick={() => { setSearch(""); setActiveCategory("All films"); setActiveEra("Any year"); }} className="mt-4 text-sm font-semibold text-violet-300 hover:text-violet-200">Clear search</button></div>}
      </section>

      <section id="how" className="mx-auto max-w-7xl scroll-mt-24 px-5 py-12 md:px-10 md:py-16"><div className="rounded-3xl border border-white/[0.08] bg-gradient-to-br from-[#171322] to-[#101116] p-7 sm:p-12"><p className="text-xs font-bold tracking-[0.2em] text-violet-400">THREE STEPS. ONE MOVIE NIGHT.</p><h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Distance is just a detail.</h2><div className="mt-10 grid gap-8 md:grid-cols-3">{[{ number: "01", title: "Create a room", description: "Start a private room and get a six-character invite code." }, { number: "02", title: "Bring your people", description: "Share the code or invite link. See who is connected in real time." }, { number: "03", title: "Sync the moment", description: "Use a YouTube link or direct video URL, synchronized playback controls, chat, and reactions." }].map((step) => <div key={step.number}><p className="text-sm font-bold text-violet-400">{step.number}</p><h3 className="mt-3 text-xl font-bold">{step.title}</h3><p className="mt-2 max-w-xs text-sm leading-6 text-zinc-400">{step.description}</p></div>)}</div></div></section>
      <footer className="border-t border-white/[0.08]"><div className="mx-auto flex max-w-7xl flex-col gap-2 px-5 py-8 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between md:px-10"><p><span className="font-bold text-white">watchparty</span> — good stories are better shared.</p><p>Class project prototype · Real-time collaboration, not a streaming service.</p></div></footer>
    </main>
  );
}
