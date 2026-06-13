// SPDX-License-Identifier: MIT

pragma solidity ^0.8.28;



library FixedPointMath {

    int256 public constant SCALE = 65536;

    uint8 internal constant SCALE_BITS = 16;



    function mul(int256 a, int256 b) internal pure returns (int256) {

        return (a * b) >> SCALE_BITS;

    }



    function div(int256 a, int256 b) internal pure returns (int256) {

        return (a << SCALE_BITS) / b;

    }



    function add(int256 a, int256 b) internal pure returns (int256) {

        return a + b;

    }



    function sub(int256 a, int256 b) internal pure returns (int256) {

        return a - b;

    }



    function sigmoid(int256 x) internal pure returns (int256) {

        if (x > 4 * SCALE) return SCALE;

        if (x < -4 * SCALE) return int256(0);

        int256 half = SCALE / 2;

        int256 c1 = 12909;

        int256 c2 = 262;

        int256 x2 = mul(x, x);

        int256 inner = mul(c1 - mul(c2, x2), x);

        return half + inner;

    }



    function relu(int256 x) internal pure returns (int256) {

        return x > 0 ? x : int256(0);

    }



    function tanh(int256 x) internal pure returns (int256) {

        int256 s = sigmoid(x);

        return mul(2 * s - SCALE, SCALE);

    }



    function gelu(int256 x) internal pure returns (int256) {

        int256 x3 = mul(mul(x, x), x);

        int256 inner = SCALE + mul(7978, x3);

        return mul(x, mul(inner, div(sigmoid(mul(11264, x)), SCALE)));

    }



    function softmax(int256[] memory logits) internal pure returns (int256[] memory out) {

        out = new int256[](logits.length);

        if (logits.length == 0) return out;

        int256 maxLogit = logits[0];

        for (uint256 i = 1; i < logits.length; i++) {

            if (logits[i] > maxLogit) maxLogit = logits[i];

        }

        int256 sum = 0;

        for (uint256 i = 0; i < logits.length; i++) {

            out[i] = sigmoid(logits[i] - maxLogit);

            sum += out[i];

        }

        if (sum > 0) {

            for (uint256 i = 0; i < logits.length; i++) {

                out[i] = div(out[i], sum);

            }

        }

    }



    function abs(int256 x) internal pure returns (int256) {

        return x < 0 ? -x : x;

    }



    function sqrt(int256 x) internal pure returns (int256) {

        if (x <= 0) return 0;

        int256 z = x;

        int256 y = (x + SCALE) / 2;

        while (y < z) {

            z = y;

            y = (div(x, y) + y) / 2;

        }

        return z;

    }



    function dot(int256[] memory a, int256[] memory b) internal pure returns (int256) {

        int256 sum = 0;

        for (uint256 i = 0; i < a.length; i++) {

            sum += mul(a[i], b[i]);

        }

        return sum;

    }



    function matVecMul(int256[][] memory M, int256[] memory v) internal pure returns (int256[] memory) {

        int256[] memory result = new int256[](M.length);

        for (uint256 i = 0; i < M.length; i++) {

            result[i] = dot(M[i], v);

        }

        return result;

    }



    function layerNorm(int256[] memory x, int256 eps)

        internal

        pure

        returns (int256[] memory y)

    {

        y = new int256[](x.length);

        if (x.length == 0) return y;

        int256 mean = 0;

        for (uint256 i = 0; i < x.length; i++) mean += x[i];

        mean = mean / int256(uint256(x.length));

        int256 varSum = 0;

        for (uint256 i = 0; i < x.length; i++) {

            int256 d = x[i] - mean;

            varSum += mul(d, d);

        }

        int256 variance = varSum / int256(uint256(x.length));

        int256 std = sqrt(variance + eps);

        if (std == 0) std = SCALE;

        for (uint256 i = 0; i < x.length; i++) {

            y[i] = div(x[i] - mean, std);

        }

    }



    function maxPool2d(

        int256[] memory inData,

        uint16 inH,

        uint16 inW,

        uint16 poolH,

        uint16 poolW

    ) internal pure returns (int256[] memory out, uint16 outH, uint16 outW) {

        outH = inH / poolH;

        outW = inW / poolW;

        out = new int256[](uint256(outH) * outW);

        for (uint16 oh = 0; oh < outH; oh++) {

            for (uint16 ow = 0; ow < outW; ow++) {

                int256 m = type(int256).min;

                for (uint16 ph = 0; ph < poolH; ph++) {

                    for (uint16 pw = 0; pw < poolW; pw++) {

                        uint16 ih = oh * poolH + ph;

                        uint16 iw = ow * poolW + pw;

                        int256 v = inData[uint256(ih) * inW + iw];

                        if (v > m) m = v;

                    }

                }

                out[uint256(oh) * outW + ow] = m;

            }

        }

    }



    function biasCorrection(int256 beta, uint256 t) internal pure returns (int256) {
        int256 pow = SCALE;
        uint256 steps = t > 64 ? 64 : t;
        for (uint256 i = 0; i < steps; i++) {
            pow = mul(pow, beta);
        }
        return div(SCALE, SCALE - pow);
    }

    function conv2dIm2col(

        int256[] memory input,

        uint16 inH,

        uint16 inW,

        int256[] memory kernel,

        uint16 kH,

        uint16 kW

    ) internal pure returns (int256[] memory out, uint16 outH, uint16 outW) {

        outH = inH >= kH ? inH - kH + 1 : 0;

        outW = inW >= kW ? inW - kW + 1 : 0;

        out = new int256[](uint256(outH) * outW);

        for (uint16 oh = 0; oh < outH; oh++) {

            for (uint16 ow = 0; ow < outW; ow++) {

                int256 sum = 0;

                for (uint16 kh = 0; kh < kH; kh++) {

                    for (uint16 kw = 0; kw < kW; kw++) {

                        int256 iv = input[uint256(oh + kh) * inW + (ow + kw)];

                        int256 kv = kernel[uint256(kh) * kW + kw];

                        sum += mul(iv, kv);

                    }

                }

                out[uint256(oh) * outW + ow] = sum;

            }

        }

    }

}


