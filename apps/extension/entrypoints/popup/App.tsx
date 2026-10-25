export default function App() {
  return (
    <main className="popup">
      <header>
        <p className="brand">AmIFooled<span aria-hidden="true">?</span></p>
        <h1>Что сайт обещает.<br />Что мы можем проверить.</h1>
      </header>
      <section className="notice" aria-labelledby="status-heading">
        <h2 id="status-heading">Проверка ещё не доступна</h2>
        <p>Здесь появятся выдержки из политики, наблюдаемые факты и история известных утечек.</p>
      </section>
      <p className="footnote">Данные сайтов пока не собираются.</p>
    </main>
  );
}
