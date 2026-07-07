import { _decorator } from 'cc';
import { YZScreenFitter } from './screen-fitter';

const { ccclass } = _decorator;

@ccclass('YZFullScreenRoot')
export class YZFullScreenRoot extends YZScreenFitter {
    protected fitMode: 'fullscreen' = 'fullscreen';
}
