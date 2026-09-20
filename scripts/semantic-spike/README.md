# Semantic Search — Phase 1 Spike

独立的离线实验，不接入网站、Actions 或 build/release。模型与图片仅在本机推理，没有将照片发送到外部推理服务。

## 运行

在仓库根目录运行，已有项目 Node dependencies，并使用 **Python 3.10–3.13（实测 3.12）**：

```bash
# 如默认 Python 是 3.14，请指定兼容的 Python。
SPIKE_PYTHON=python3.12 bash scripts/semantic-spike/run.sh
```

默认使用 Apple MPS。没有可用 MPS 时显式设置 `SPIKE_DEVICE=cpu`，不会静默改用 CPU 混淆计时。在限制 GPU/联网的沙箱中运行需要相应执行权限。

`run.sh` 创建 `.cache/semantic-spike/venv`，安装独立 Python 依赖，顺序执行两款模型，避免 GPU 争用。不会安装或更改项目的 pnpm dependencies。首次模型下载约需 2.2 GB 磁盘，此外还需 Python 环境、安装缓存与抽样原图的空间。

`prepare.ts` 直接调用现有 `loadPublicPhotoCollection()`，按公开成员去重并排除草稿。它使用 `public/thumbnails/`，缺少真实导出数据时自动执行现有 `pnpm photos --export --root .cache/semantic-spike/photo-engine`。无需本地完整原图库。该流程按现有约定写入被忽略的 `src/data/` 和 `public/thumbnails/`，其临时处理数据位于本实验 cache。现有 pnpm/照片源凭据要求与原流程一致。

本实验要求原图 URL 来自当前仓库使用的、固定 commit 的 GitHub raw 来源；未来新增照片来源时，需要明确适配 `prepare.ts` 的来源检查。

所有模型、embedding、下载原图、contact sheets、benchmark JSON/CSV/HTML 和报告都位于 `.cache/semantic-spike/`。现有根 `.gitignore` 已忽略整个 `.cache/`。不要使用 `git add -f` 添加这些产物。

## 独立步骤与查询

```bash
node --import tsx scripts/semantic-spike/prepare.ts
.cache/semantic-spike/venv/bin/python -B scripts/semantic-spike/download.py models
.cache/semantic-spike/venv/bin/python -B scripts/semantic-spike/download.py originals
.cache/semantic-spike/venv/bin/python -B scripts/semantic-spike/experiment.py benchmark --model siglip2
.cache/semantic-spike/venv/bin/python -B scripts/semantic-spike/experiment.py benchmark --model clip
.cache/semantic-spike/venv/bin/python -B scripts/semantic-spike/review.py

.cache/semantic-spike/venv/bin/python -B scripts/semantic-spike/experiment.py search \
  --model siglip2 --query '阳光照亮的雪山' --top-k 5
.cache/semantic-spike/venv/bin/python -B scripts/semantic-spike/experiment.py search \
  --model clip --query 'a chipmunk eating from a hand' --top-k 10
```

推理只读取下载好的固定 revision，不访问模型网络。`search` 是一次性 CLI，会支付 Python 导入和模型加载成本；benchmark 的 query latency 是模型常驻、预热后的延迟，两者不可混用。使用 `--device cpu` 可显式在 CPU 运行。相同模型的 benchmark 会覆盖其旧结果；要保留不同设备结果，请先在实验 cache 内备份该模型目录。

## 模型与预处理

- `google/siglip2-base-patch16-224`：多语言候选，固定 revision 见 `models.json`。768 维，原图 EXIF 校正、RGB、官方 processor 的 224×224 bilinear resize（不做 center crop），rescale 1/255，mean/std 均为 0.5。原始文本直接 tokenization、padding 到 64，不翻译、不加分类 prompt。
- `openai/clip-vit-base-patch32`：更小的英文对照，512 维，官方 processor 的短边 224 bicubic resize + 224 center crop 与 CLIP mean/std，文本 padding 到 77。中文也直接输入；它并非中文支持候选。
- 两者使用同 revision 的 image/text towers、FP32、eager attention、`eval()` + `inference_mode()`，输出 L2 normalize 后做精确 cosine 排序。不将照片标题、标签、项目、文件名或位置加入 embedding，不使用 sigmoid/softmax 值冒充概率。
- 完整 processor 配置、模型参数量、实际下载字节数、权重 SHA-256、runtime versions、设备信息均保存在模型 `results.json`。

## 评估与复核

`queries.json` 包含 24 组中英对照，共 48 条，22 组正例主题与 2 组不存在的场景。保留每条查询的相关性标准。先看 contact sheets 再标注，可减少根据模型排名修改标准的倾向；这仍是当前图库上的探索性 benchmark，不是独立测试集。

产物入口：

- `.cache/semantic-spike/SPIKE_REPORT.md`：本次实测的解读报告（手写，重跑后需复核更新）。
- `.cache/semantic-spike/metrics.md`：`review.py` 从当前结果生成的指标汇总。
- `.cache/semantic-spike/{siglip2,clip}/review.html`：每个查询 Top-5，展开 6–10，以及原图/thumbnail 对照。可直接用浏览器打开；图片使用相对路径引用现有 `public/thumbnails/`。
- `.cache/semantic-spike/{siglip2,clip}/top10.csv`：查询、rank、public ID、filename、cosine 与初步相关性。
- `corpus.json` / `originals.json`：照片顺序、源 snapshot、图片 hash、采样 seed；`.npy` 使用相同顺序。

实际相关性使用可选 `.cache/semantic-spike/annotations.json`：

```json
{
  "corpusFingerprint": "从 corpus.json 复制",
  "annotator": "记录实际标注者和方法；AI 检查不能写成人工评测",
  "qrels": {
    "golden-mountain": ["从 corpus.json 复制相关照片的完整 id"],
    "absent-plane": []
  }
}
```

`qrels` 必须为 `queries.json` 中每个 intent 提供数组；两种语言共享相关照片集合。无需模型得分来定义相关性。没有标注文件时，完整 embedding、计时、排名与原图稳定性仍可运行，相关性指标留空；不能从排名重合率推断准确率。修改标注后运行 `review.py` 重新评分，无需重新测量推理速度。本次初步标注和更正记录只保存在 cache，清理 cache 后应重新进行视觉标注。

正例报告 Hit@1/5/10、MRR、Precision/Recall、binary nDCG@5/10；无结果控制不进入正例分母。相关照片不足 K 时，Precision@K 上限本来就低，应结合 nDCG/Recall。双语 Top-K 重合仅表示一致性。库中没有匹配图片时纯 Top-K 仍会返回结果，本阶段没有校准拒答阈值。

图片计时含文件解码、processor、GPU、同步、normalize 和 CPU 拷回，不含模型下载/加载与最终写盘；另存两个 warm-up batch 的耗时。查询用单条 batch、每条重复三次、固定 seed 打乱顺序，包含 text embedding、cosine 与排序，每次 MPS synchronize。

原图按固定 seed 对公开照片 ID 作 SHA-256 排序，无放回取 24 张，失败会明确报错、不偷偷换样本。比较同一 24 张候选集的 embedding cosine、Top-K overlap、排名相关系数与相关性指标；另报告在全库中只替换这 24 张向量的变化。原图只是输入差异，仍用各模型相同的官方预处理。小样本结果不代表文字识别、极小物体等细粒度任务。

## 验证

```bash
.cache/semantic-spike/venv/bin/python -B -m unittest discover -s scripts/semantic-spike -p 'test_*.py'
.cache/semantic-spike/venv/bin/python -B scripts/semantic-spike/review.py
node node_modules/typescript/bin/tsc --noEmit
git check-ignore .cache/semantic-spike/corpus.json
```

数学测试覆盖 cosine normalization、无效向量、稳定排序、稀疏相关性分母、nDCG 和无结果控制。`review.py` 另验证真实产物的维度、单位范数、ID 顺序、corpus/query/revision 一致性与保存的排名。

来源：[SigLIP2 模型卡](https://huggingface.co/google/siglip2-base-patch16-224)、[CLIP 模型卡](https://huggingface.co/openai/clip-vit-base-patch32)、[SigLIP padding 指引](https://huggingface.co/docs/transformers/model_doc/siglip)。
