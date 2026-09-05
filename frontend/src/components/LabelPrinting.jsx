const LABELS_APP_URL = "https://spicetown-server.tailcc1217.ts.net:8443/";

export default function LabelPrinting() {
  return (
    <section className="card">
      <h2>Label printing</h2>
      <p className="muted">
        Scan a barcode and print a price label on the Brother QL-810W - runs on
        this server now, printing locally in-store.
      </p>
      <a className="button-link" href={LABELS_APP_URL} target="_blank" rel="noopener noreferrer">
        Open label scanner
      </a>
    </section>
  );
}
