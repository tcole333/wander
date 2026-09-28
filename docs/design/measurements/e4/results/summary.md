# E4 results (this Mac only)

Wait is curl's time from request sent to first byte, excluding DNS, TCP and TLS. The break point is 500 ms per miss (streaming design 8.2, E4).

| Checkpoint | Hours after warm | First-read hits | Second-read hits | Wait p50 / p90 ms | Miss wait p50 / p90 ms | Bad bodies / headers | Data centers |
|---|---|---|---|---|---|---|---|
| warm | 0.0 | 0/200 | 200/200 | 142.2 / 234.3 | 142.2 / 234.3 | 0 / 0 | BOS |
| 24h | 24.01 | 50/50 | 50/50 | 26.65 / 43.6 | None / None | 0 / 0 | BOS |
| 72h | 72.01 | 50/50 | 50/50 | 27.15 / 38.0 | None / None | 0 / 0 | BOS |
