(() => {
  "use strict";

  const loadedAt = document.getElementById("loadedAt");
  const currentTime = document.getElementById("currentTime");
  const refreshCount = document.getElementById("refreshCount");

  const formatTime = (d) =>
    new Intl.DateTimeFormat("th-TH", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).format(d);

  const loaded = new Date();
  loadedAt.textContent = formatTime(loaded);

  const key = "factory_refresh_test_count";
  const count = Number(sessionStorage.getItem(key) || 0) + 1;
  sessionStorage.setItem(key, String(count));
  refreshCount.textContent = String(count);

  const tick = () => {
    currentTime.textContent = formatTime(new Date());
  };

  tick();
  setInterval(tick, 1000);
})();
