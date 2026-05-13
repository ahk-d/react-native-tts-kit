import Foundation
import onnxruntime_objc

/// Loads a single voice style file from upstream's `voice_styles/<id>.json`.
///
/// Each file contains two 3D float tensors used by the duration predictor and
/// the text encoder respectively:
///
/// ```json
/// {
///   "style_ttl": { "data": [[[…]]], "dims": [1, D1, D2], "type": "f32" },
///   "style_dp":  { "data": [[[…]]], "dims": [1, D1, D2], "type": "f32" }
/// }
/// ```
final class VoicePack {
    let voiceId: String
    let ttlValue: ORTValue
    let dpValue: ORTValue

    init(voiceId: String, url: URL) throws {
        self.voiceId = voiceId
        let data = try Data(contentsOf: url)
        let decoded = try JSONDecoder().decode(VoiceStyleJSON.self, from: data)

        let ttlFlat = decoded.style_ttl.data.flatMap { $0.flatMap { $0 } }
        let ttlShape = decoded.style_ttl.dims.map { NSNumber(value: $0) }
        self.ttlValue = try ORTValue(
            tensorData: NSMutableData(bytes: ttlFlat, length: ttlFlat.count * MemoryLayout<Float>.size),
            elementType: .float,
            shape: ttlShape
        )

        let dpFlat = decoded.style_dp.data.flatMap { $0.flatMap { $0 } }
        let dpShape = decoded.style_dp.dims.map { NSNumber(value: $0) }
        self.dpValue = try ORTValue(
            tensorData: NSMutableData(bytes: dpFlat, length: dpFlat.count * MemoryLayout<Float>.size),
            elementType: .float,
            shape: dpShape
        )
    }
}

private struct VoiceStyleJSON: Decodable {
    struct Component: Decodable {
        let data: [[[Float]]]
        let dims: [Int]
        let type: String
    }
    let style_ttl: Component
    let style_dp: Component
}
