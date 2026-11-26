# Changelog

## v0.1.0

- hugo-gh-admin v0.8.1 を基に、保存先を GitLab（gitlab.com とセルフホスト）に変更した。
- 設定は `params.glAdmin`、partial・データ・静的ファイルのフォルダは `gl-admin` に変更した。
- `params.glAdmin.gitlabURL` を追加した（既定値は `https://gitlab.com`）。
- `tokenProvider` のモジュールが持つ関数を `getGitLabToken()` に変更した。
