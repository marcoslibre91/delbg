import ProcessorLoader from "@/components/ProcessorLoader";
import VersionBadge from "@/components/VersionBadge";

export default function Home() {
  return (
    <>
      <header className="app-header">
        <h1>Shopify Image Processor</h1>
        <p>
          Foto prodotto con sfondo uniforme: seleziona le immagini (anche HEIC), scegli il colore, scarica i JPG
          pronti per Shopify.
        </p>
      </header>
      <ProcessorLoader />
      <VersionBadge />
    </>
  );
}
