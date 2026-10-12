# 第三方许可与例外 / Third-party notices and exceptions

## 适用范围 / Scope

根 [LICENSE](LICENSE) 的 MIT 授权适用于 ZhongTyler 在本仓发布的原创代码与文档，不替代第三方版权、许可或来源限制。下列内容是明确例外；文件内的版权、许可与来源记录继续有效。引用外部文章、书籍或工具，不授予其正文、商标或其他未随仓分发内容的使用权。没有上游背书或效果保证。

The root [LICENSE](LICENSE) grants MIT rights to original code and documentation published here by ZhongTyler. It does not replace third-party copyrights, licenses or source restrictions. The following are explicit exceptions; notices and provenance records within files remain effective. References to external articles, books or tools do not grant rights to their full text, trademarks or other material not distributed here. No upstream endorsement or guarantee of results is implied.

## Skills

| 内容 / Content | 上游 / Upstream | 适用许可与本地记录 / Terms and local records |
|---|---|---|
| Humanizer-zh（meta 与 Skills 包两份 / both copies） | [op7418/Humanizer-zh](https://github.com/op7418/Humanizer-zh), Copyright 2026 歸藏 | MIT：[meta 许可](meta/workspace/.agents/skills/humanizer-zh/references/LICENSE)、[来源与改动](meta/workspace/.agents/skills/humanizer-zh/references/UPSTREAM.md)；[Skills 许可](packages/skills/library/humanizer-zh/references/LICENSE)、[来源与改动](packages/skills/library/humanizer-zh/references/UPSTREAM.md) |
| systematic-debugging | [obra/superpowers](https://github.com/obra/superpowers), Copyright 2025 Jesse Vincent | [MIT](packages/skills/library/systematic-debugging/references/LICENSE)；来源版本见 [Skill](packages/skills/library/systematic-debugging/SKILL.md) / upstream version is recorded in the Skill |
| godot-gdscript-patterns | [wshobson/agents](https://github.com/wshobson/agents/tree/main/plugins/game-development/skills/godot-gdscript-patterns), Copyright 2024 Seth Hobson | [MIT](packages/skills/library/godot-gdscript-patterns/references/LICENSE)；[来源与改动 / provenance and changes](packages/skills/library/godot-gdscript-patterns/references/UPSTREAM.md) |
| property-based-testing | [Trail of Bits](https://github.com/trailofbits/skills/tree/main/plugins/property-based-testing/skills/property-based-testing) | [CC BY-SA 4.0](packages/skills/library/property-based-testing/references/LICENSE)；[来源与改动 / provenance and changes](packages/skills/library/property-based-testing/references/UPSTREAM.md) |

property-based-testing 的上游内容与其改编继续按 CC BY-SA 4.0 处理，不转为 MIT。再分发或改编时保留署名、许可链接和改动说明，并按原许可处理改编内容。

Upstream property-based-testing content and adaptations remain under CC BY-SA 4.0, not MIT. Retain attribution, license links and change notices when redistributing or adapting, and follow the original license for adaptations.

## 素材与字体 / Assets and fonts

[PrototypeAssets 来源目录](packages/prototype-assets/catalog/sources.json)和[正式精选来源目录](packages/prototype-assets/catalog/formal-sources.json)逐项记录来源、许可标识与收据路径；[许可目录](packages/prototype-assets/licenses)保留许可证据。媒体文件不因装入本仓而转为 MIT。

The [PrototypeAssets source catalog](packages/prototype-assets/catalog/sources.json) and [formal selection source catalog](packages/prototype-assets/catalog/formal-sources.json) record sources, license identifiers and receipt paths. The [license directory](packages/prototype-assets/licenses) retains supporting records. Inclusion here does not relicense media under MIT.

- Kenney 与 OpenGameArt 的当前收录项：CC0-1.0，按各来源收据和许可文件核对。 / Currently included Kenney and OpenGameArt items: CC0-1.0; consult each source receipt and license file.
- Noto Sans CJK SC Regular：[SIL Open Font License 1.1](packages/prototype-assets/licenses/noto-sans-cjk-sc-regular-f8d15753-LICENSE.txt)，来源 [noto-cjk](https://github.com/notofonts/noto-cjk)。字体再分发与修改按 OFL 处理。 / Font redistribution and modifications follow the OFL.

## 方法来源限制 / Method source restrictions

Brainstorm 的[来源注册表](packages/brainstorm/docs/research/public-sources.md)与[机器记录](packages/brainstorm/docs/research/public-sources.json)区分链接、书目信息、事实及允许的复用范围。引用不表示复制了外部正文，也不表示外部内容采用本仓许可。

The Brainstorm [source register](packages/brainstorm/docs/research/public-sources.md) and [machine-readable record](packages/brainstorm/docs/research/public-sources.json) distinguish links, bibliographic metadata, facts and permitted reuse. A citation does not mean external full text is copied or licensed under this repository's terms.

**明确例外：** [How Might We 方法卡](packages/brainstorm/methods/framing/how-might-we.md)不纳入根 MIT 授权。其 `SRC-HMW-001` 来源为 [Stanford d.school](https://dschool.stanford.edu/tools/how-might-we-questions)，现有来源记录登记为 CC BY-NC-SA 4.0，复用范围为署名、非商业改编。相关来源内容和改编应遵守其适用条款；不能依据根 MIT 推定商业复用已经获准。登记日期是 2026-07-29，不是新的法律审查或新增授权。另一来源 IDEO.org 登记为仅链接引用。

**Explicit exception:** the [How Might We method card](packages/brainstorm/methods/framing/how-might-we.md) is excluded from the root MIT grant. Its `SRC-HMW-001` source is [Stanford d.school](https://dschool.stanford.edu/tools/how-might-we-questions). The existing source record identifies CC BY-NC-SA 4.0 and attribution/noncommercial adaptation. Relevant source material and adaptations remain subject to applicable source terms; the root MIT license does not establish permission for commercial reuse. The recorded review date is 2026-07-29, not a new legal review or grant. The other source, IDEO.org, is recorded as link-only.

## 复制、安装与再分发 / Copying, installation and redistribution

复制或再分发原创内容时附带根 MIT 声明；涉及上述例外时，同时保留其许可、版权、来源和改动说明。按文件与实际来源判断，不把整个仓库宣传成“全部 MIT”或“全部可商用”。仅安装某个包或导出素材不会改变原许可；如选出的副本不含根许可与本说明，再分发前请从发布仓补齐适用记录。

Include the root MIT notice when copying or redistributing original content. For exceptions above, also retain applicable licenses, copyrights, provenance and change notices. Determine rights by file and source; do not describe the whole repository as entirely MIT or entirely cleared for commercial use. Installing a package or exporting an asset does not change its license. If selected copies omit the root license or this notice, include the applicable records from the distribution before redistribution.

## Travel

Travel original code and documentation use MIT, confirmed by the rights holder on 2026-10-11. Its bundled Humanizer-zh retains its own MIT copyright and pinned source record. See [Travel license](packages/travel/LICENSE-NOTICE.md) and [sources and optional services](packages/travel/THIRD_PARTY.md). No third-party service binaries, browser, real trips, orders, account data or source photographs are bundled. Online services and user-collected content retain their own terms.

## Research

Research original code and documentation use the bundled [MIT license](packages/research/LICENSE). Pinned MCP source and npm archives retain their own licenses and notices: [package boundaries](packages/research/LICENSE-NOTICE.md), [upstream notices](packages/research/integrations/mcp/THIRD_PARTY_NOTICES.txt), [source lock](packages/research/integrations/mcp/source-lock.json). Optional browser/media downloads and collected articles/videos retain upstream terms; they are not relicensed by this repository. Unlicensed Stack Overflow source archives, private research, credentials and host runtime are excluded.

Research's optional REA archive and matching official skill references retain the upstream [MIT license](packages/research/integrations/rea/vendor/REA-LICENSE.txt); version, source commit and integrity are recorded in the [REA lock](packages/research/integrations/rea/source-lock.json). Installed transitive dependencies, native providers and recipient client configuration are not bundled.
