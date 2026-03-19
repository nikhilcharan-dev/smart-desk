import {
  ParticleBackground,
  CursorSpotlight,
  Navbar,
  Hero,
  StatsBar,
  WhySection,
  Features,
  OpsPilotSection,
  HowItWorks,
  MobileTeaser,
  DownloadCTA,
  Footer,
} from "./components";

export default function Home() {
  return (
    <main style={{ position: "relative", minHeight: "100vh" }}>
      <ParticleBackground />
      <CursorSpotlight />
      <Navbar />
      <Hero />
      <StatsBar />
      <WhySection />
      <Features />
      <OpsPilotSection />
      <HowItWorks />
      <MobileTeaser />
      <DownloadCTA />
      <Footer />
    </main>
  );
}
