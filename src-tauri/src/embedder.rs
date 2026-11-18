//! On-device sentence embeddings with a small BERT retrieval model
//! (snowflake-arctic-embed-xs, 6 layers, 384 dimensions) running on candle.
use std::path::Path;

use anyhow::{anyhow, Result};
use candle_core::{DType, Device, IndexOp, Tensor};
use candle_nn::VarBuilder;
use candle_transformers::models::bert::{BertModel, Config};
use tokenizers::{PaddingParams, PaddingStrategy, Tokenizer, TruncationParams};

/// arctic-embed expects this instruction on queries only, never on documents.
const QUERY_PREFIX: &str = "Represent this sentence for searching relevant passages: ";
const MAX_TOKENS: usize = 512;

pub struct TextEmbedder {
    model: BertModel,
    tokenizer: Tokenizer,
    device: Device,
}

impl TextEmbedder {
    pub fn load(dir: &Path) -> Result<Self> {
        let device = Device::Cpu;
        let config: Config = serde_json::from_slice(&std::fs::read(dir.join("config.json"))?)?;
        let mut tokenizer = Tokenizer::from_file(dir.join("tokenizer.json")).map_err(|error| anyhow!(error))?;
        tokenizer
            .with_truncation(Some(TruncationParams { max_length: MAX_TOKENS, ..Default::default() }))
            .map_err(|error| anyhow!(error))?;
        tokenizer.with_padding(Some(PaddingParams { strategy: PaddingStrategy::BatchLongest, ..Default::default() }));
        // Weights may be stored as f16 to halve the bundle; they are widened on load.
        let vb = unsafe { VarBuilder::from_mmaped_safetensors(&[dir.join("model.safetensors")], DType::F32, &device)? };
        let model = BertModel::load(vb, &config)?;
        Ok(Self { model, tokenizer, device })
    }

    /// Returns L2-normalized CLS embeddings, one per input text.
    pub fn embed(&self, texts: &[String], query: bool) -> Result<Vec<Vec<f32>>> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }
        let inputs: Vec<String> = texts
            .iter()
            .map(|text| if query { format!("{QUERY_PREFIX}{text}") } else { text.clone() })
            .collect();
        let encodings = self.tokenizer.encode_batch(inputs, true).map_err(|error| anyhow!(error))?;
        let ids = encodings
            .iter()
            .map(|encoding| Tensor::new(encoding.get_ids(), &self.device))
            .collect::<candle_core::Result<Vec<_>>>()?;
        let masks = encodings
            .iter()
            .map(|encoding| Tensor::new(encoding.get_attention_mask(), &self.device))
            .collect::<candle_core::Result<Vec<_>>>()?;
        let ids = Tensor::stack(&ids, 0)?;
        let mask = Tensor::stack(&masks, 0)?;
        let token_types = ids.zeros_like()?;
        let hidden = self.model.forward(&ids, &token_types, Some(&mask))?;
        let cls = hidden.i((.., 0))?;
        let norms = cls.sqr()?.sum_keepdim(1)?.sqrt()?.clamp(1e-12, f64::MAX)?;
        Ok(cls.broadcast_div(&norms)?.to_vec2::<f32>()?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{path::PathBuf, time::Instant};

    /// Run with `cargo test --lib embedder_quality -- --ignored --nocapture`.
    #[test]
    #[ignore = "needs the downloaded recall model"]
    fn embedder_quality() {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("recall-model");
        let started = Instant::now();
        let embedder = TextEmbedder::load(&dir).unwrap();
        println!("loaded in {:?}", started.elapsed());
        let documents = vec![
            "We controlled for selection bias using propensity score matching across cohorts.".to_string(),
            "The model reached 91.2% accuracy on the held-out test set after fine-tuning.".to_string(),
            "A key limitation is the small sample of 48 participants from one university.".to_string(),
            "I led a team of five engineers to migrate the payments service to Kubernetes.".to_string(),
            "My favourite food is ramen and I play guitar on weekends.".to_string(),
            "Future work will extend the method to multilingual speech corpora.".to_string(),
        ];
        let queries = [
            ("How did you handle confounding variables?", 0),
            ("How well did it perform on unseen data?", 1),
            ("What are the weaknesses of your study?", 2),
            ("Tell me about a time you led people through a big infrastructure change", 3),
            ("Where would you take this research next?", 5),
        ];
        let started = Instant::now();
        let doc_vectors = embedder.embed(&documents, false).unwrap();
        println!("embedded {} docs in {:?}", documents.len(), started.elapsed());
        let long = vec!["word ".repeat(300)];
        let started = Instant::now();
        embedder.embed(&long, false).unwrap();
        println!("embedded one ~300-token chunk in {:?}", started.elapsed());
        let mut correct = 0;
        for (query, expected) in queries {
            let started = Instant::now();
            let q = embedder.embed(&[query.to_string()], true).unwrap().remove(0);
            let elapsed = started.elapsed();
            let mut scores: Vec<(usize, f32)> = doc_vectors.iter().enumerate()
                .map(|(i, d)| (i, d.iter().zip(&q).map(|(a, b)| a * b).sum())).collect();
            scores.sort_by(|a, b| b.1.total_cmp(&a.1));
            if scores[0].0 == expected { correct += 1; }
            println!("{query:?} -> top {} ({:.3}), expected {} ({:.3}), second {:.3}, {:?}",
                scores[0].0, scores[0].1, expected,
                scores.iter().find(|s| s.0 == expected).unwrap().1, scores[1].1, elapsed);
        }
        println!("top-1: {correct}/{}", queries.len());

        let distractors: Vec<String> = [
            "The weather in Lisbon was sunny all week.", "Preheat the oven to 200 degrees before baking.",
            "The train to Munich leaves at 7:40 from platform 3.", "She adopted a grey cat named Pixel.",
            "Quarterly revenue grew 12% year over year.", "Remember to renew the car insurance in March.",
            "The museum is closed on Mondays.", "He scored two goals in the second half.",
            "Water boils at lower temperatures at high altitude.", "The concert tickets sold out in an hour.",
            "Our office moved to the fourth floor.", "Use a soft brush to clean the camera lens.",
            "The library extended its opening hours.", "I usually drink green tea in the afternoon.",
            "The bridge was built in 1932.", "Plant tomatoes after the last frost.",
            "The password must contain at least twelve characters.", "They hiked to the summit before sunrise.",
            "The invoice is due within thirty days.", "Bananas ripen faster in a paper bag.",
        ].iter().map(|s| s.to_string()).collect();
        let distractor_vectors = embedder.embed(&distractors, false).unwrap();
        let mut background = Vec::new();
        for (query, expected) in queries {
            let q = embedder.embed(&[query.to_string()], true).unwrap().remove(0);
            let sims: Vec<f32> = distractor_vectors.iter().map(|d| d.iter().zip(&q).map(|(a, b)| a * b).sum()).collect();
            let mean = sims.iter().sum::<f32>() / sims.len() as f32;
            let std = (sims.iter().map(|s| (s - mean).powi(2)).sum::<f32>() / sims.len() as f32).sqrt();
            let relevant: f32 = doc_vectors[expected].iter().zip(&q).map(|(a, b)| a * b).sum();
            println!("{query:?}: background mean {mean:.3} std {std:.3} max {:.3}; relevant {relevant:.3} (z {:.1})",
                sims.iter().cloned().fold(f32::MIN, f32::max), (relevant - mean) / std);
            background.extend(sims);
        }
        let mean = background.iter().sum::<f32>() / background.len() as f32;
        let std = (background.iter().map(|s| (s - mean).powi(2)).sum::<f32>() / background.len() as f32).sqrt();
        println!("pooled background: mean {mean:.3} std {std:.3}");

        let pairs = [
            ("My advisor is Prof. Rao.", "Prof. Rao is my advisor.", true),
            ("I prefer short answers with one example.", "Keep answers brief and give a single example.", true),
            ("My advisor is Prof. Rao.", "My co-author is Prof. Rao.", false),
            ("My thesis is on speech recognition for low-resource languages.", "My thesis is on machine translation for low-resource languages.", false),
            ("I presented at ACL 2025.", "I will present at ACL 2026.", false),
        ];
        for (a, b, same) in pairs {
            let v = embedder.embed(&[a.to_string(), b.to_string()], false).unwrap();
            let sim: f32 = v[0].iter().zip(&v[1]).map(|(x, y)| x * y).sum();
            println!("dedupe {sim:.3} same={same}: {a:?} / {b:?}");
        }
    }
}
