# Chromeの削除確認とAXPress

出典: 下記Chromium一次ソース。取得日: 2026-09-26。確度: ソースとMac実測で確認。

- [View::HandleAccessibleAction](https://github.com/chromium/chromium/blob/153.0.8010.53/ui/views/view.cc) はアクセシビリティの既定アクションをマウス押下・解放へ変換する。
- [DialogClientView::ButtonPressed](https://github.com/chromium/chromium/blob/153.0.8010.53/ui/views/window/dialog_client_view.cc) は入力保護の判定後に確認処理を呼ぶ。
- [入力保護](https://github.com/chromium/chromium/blob/153.0.8010.53/ui/views/input_protection/default_input_protection_policy.cc) は表示・位置変更直後と短い間隔の入力を拒否する。
- [Macの時間設定](https://github.com/chromium/chromium/blob/153.0.8010.53/ui/views/metrics_mac.cc) は500ミリ秒。OSのダブルクリック設定値から取得しているわけではない。

実測では、確認画面の出現直後のAXPressは成功を返すが画面が残った。1.5秒待った診断では同じAXPressで閉じた。本体は600ミリ秒待って一度だけ押し、画面が閉じたことを確認する。続くMCPの正常な管理API応答でfixtureの不在を確認できた。入力保護を無効化する設定や座標クリックは追加していない。

AXPressの戻り値は削除成立の証拠にしない。
