# ローカル開発・展示運用

## 初回セットアップ

Node.js、Python 3.9以上、`uv`が入ったMacで実行する。

```sh
npm install
uv sync
```

これによりp5.jsをローカルへ置き、カメラを使わない追跡サーバーを起動できる。`node_modules/`と`.venv/`はGitへ追加しない。

## モック入力で起動

```sh
uv run mojihokori-server --source mock
```

用途に応じて次のURLを開く。

| URL | 用途 |
| --- | --- |
| `http://127.0.0.1:8765/` | 従来のマウス操作 |
| `http://127.0.0.1:8765/?input=tracking` | 物体図形を表示する追跡デバッグ |
| `http://127.0.0.1:8765/?mode=exhibit` | UIと物体図形を消した本番表示 |
| `http://127.0.0.1:8765/api/status` | 運営用の追跡状態 |

モックは24秒周期で、空の画面、餌の追加・移動、障害物の追加、複数物体、削除を順に送る。本番表示はブラウザの全画面またはmacOSのキオスク相当の設定で開く。

## 状態の保存と朝のリセット

展示モードは30秒ごとに、その日のシミュレーション状態をIndexedDBへ保存する。同じ日のブラウザ再読み込みやクラッシュ後は直近状態を復元する。別の日の保存状態は復元しない。

朝に初期状態へ戻すときだけ、次を一度開く。

```text
http://127.0.0.1:8765/?mode=exhibit&reset=1
```

消去後はブラウザのURLから`reset=1`が自動で外れる。そのため、その後の自動再読み込みで状態が繰り返し消去されることはない。`S`キーで作品画面のスクリーンショットを保存できる。

## iPad / Camo入力を確認

実カメラ用依存を追加する。

```sh
uv sync --extra vision
uv run mojihokori-camera-probe
```

1. iPad AirへCamo Camera、MacへCamo Studioを入れる
2. USB-Cで接続し、Camo Studioに背面カメラ映像を出す
3. macOSのカメラ権限をターミナルまたは起動アプリへ許可する
4. 露出、ホワイトバランス、フォーカスを固定する
5. `mojihokori-camera-probe`が表示したindexを`config/tracking.json`の`camera.index`へ書く

CamoをOpenCVから直接取得できない場合、Camo映像をOBSへ入れ、OBS Virtual Cameraを開始して再度indexを調べる。

## キャリブレーション

`config/tracking.json`の`camera.screenCorners`へ、カメラ画像上の画面四隅をピクセル座標で設定する。順番は左上、右上、右下、左下とする。

```json
"screenCorners": [
  [214, 126],
  [1708, 132],
  [1716, 970],
  [205, 964]
]
```

未設定の`null`では映像全体を画面として正規化する。カメラや箱を動かした場合は値を取り直す。

## データ撮影と学習

実物と最終照明が決まった後、撮影セッションごとに保存先を分ける。

```sh
uv run mojihokori-capture data/raw/v001/session-01 --camera 0 --count 300 --interval 0.5
```

アノテーション後、Ultralytics形式のdataset YAMLを作成して学習する。

```sh
uv run mojihokori-train data/annotated/v001/dataset.yaml \
  --model yolo11n-seg.pt \
  --device mps \
  --seed 42 \
  --name v001-seed42
```

採用した重みを`models/best.pt`へ置き、`config/tracking.json`の`source`を`camera`へ変えるか、次のように上書きして起動する。

```sh
uv run mojihokori-server --source camera
```

データ、アノテーション、学習済み重み、実験ログはリポジトリへコミットしない。評価条件と合格基準は[物体認識の実験計画](tracking-experiment.md)に従う。

## 検証

```sh
npm run check
npm test
uv run python -m unittest discover -s tests/python -v
```

展示前には、モック入力で追加・移動・削除と休眠を確認した後、実カメラで30分試験、最終構成で10時間試験を行う。
